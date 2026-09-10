import * as ST from '../../../../script.js';
const { saveSettingsDebounced } = ST;
import { extension_settings } from '../../../extensions.js';

const settings = {
    provider: {
        claude: [],
        openai: [],
        google: [],
        custom: [],
    },
    openai_model: undefined,
    claude_model: undefined,
    google_model: undefined,
    custom_model: undefined,
};
Object.assign(settings, extension_settings.customModels ?? {});
// Preserve older provider lists while adding newly supported connections.
const providers = ['claude', 'openai', 'google', 'custom'];
const normalizeModels = models => [...new Set((Array.isArray(models) ? models : [])
    .filter(model => typeof model === 'string').map(model => model.trim()).filter(Boolean))];
settings.provider = Object.fromEntries(providers.map(provider => [
    provider, normalizeModels(settings.provider?.[provider]),
]));

// Resolve popup APIs on click, never block mounting behind a top-level import.
let popupApi;
function getPopupApi() {
    return popupApi ??= (async () => {
        try {
            const popup = await import('../../../popup.js');
            return { caller: popup.callGenericPopup, type: popup.POPUP_TYPE.TEXT, affirmative: popup.POPUP_RESULT.AFFIRMATIVE };
        } catch {
            return { caller: ST.callPopup, type: 1, affirmative: 1 };
        }
    })();
}

const mounted = new Map();
function mountProvider(provider, models) {
    const sel = /**@type {HTMLSelectElement}*/(document.querySelector(`#model_${provider}_select`));
    const customInput = provider === 'custom' ? document.querySelector('#custom_model_id') : null;
    // ST 1.18 may rebuild connection controls. Mount against the actual input,
    // with a wrapper fallback rather than permanently skipping an unknown heading.
    const heading = provider === 'custom'
        ? document.querySelector('#custom_form h4[data-i18n="Enter a Model ID"]')
            ?? document.querySelector('label[for="custom_model_id"]')
            ?? customInput?.closest('.flex-container')?.previousElementSibling
        : sel?.parentElement?.querySelector('h4, label, legend');
    const h4 = heading?.matches('h3, h4, label, legend') ? heading : (customInput ?? sel)?.parentElement;
    if (!sel || !h4 || (provider === 'custom' && !customInput)) return;
    const previous = mounted.get(provider);
    if (previous?.sel === sel && previous.h4 === h4 && previous.input === customInput && previous.btn.isConnected) return;
    previous?.dispose();
    h4.querySelector('.stcm--btn')?.remove();
    const btn = document.createElement('button'); {
        btn.type = 'button';
        btn.dataset.stcmVersion = '1.4.1';
        btn.classList.add('stcm--btn');
        btn.classList.add('menu_button');
        btn.classList.add('fa-solid', 'fa-fw', 'fa-pen-to-square');
        btn.title = 'Edit custom models';
        btn.setAttribute('aria-label', `Edit custom models (${provider})`);
        btn.addEventListener('click', async()=>{
            let inp;
            const dom = document.createElement('div'); {
                const header = document.createElement('h3'); {
                    header.textContent = `Custom Models: ${provider}`;
                    dom.append(header);
                }
                const hint = document.createElement('small'); {
                    hint.textContent = 'one model name per line';
                    dom.append(hint);
                }
                inp = document.createElement('textarea'); {
                    inp.classList.add('text_pole');
                    inp.rows = 20;
                    inp.value = models.join('\n');
                    dom.append(inp);
                }
            }
            const popup = await getPopupApi();
            const result = await popup.caller(dom, popup.type, null, { okButton: 'Save' });
            if (result == popup.affirmative) {
                while (models.pop());
                models.push(...normalizeModels(inp.value.split(/\r?\n/)));
                extension_settings.customModels = settings;
                saveSettingsDebounced();
                populateOptGroup();
                if (provider !== 'custom' && settings[`${provider}_model`] && models.includes(settings[`${provider}_model`])) {
                    sel.value = settings[`${provider}_model`];
                    sel.dispatchEvent(new Event('change', { bubbles:true }));
                }
            }
        });
        h4.append(btn);
    }
    const populateOptGroup = ()=>{
        // The custom input belongs to ST and is authoritative across connection
        // profile switches. Never replace it with an extension's stale selection.
        const selected = customInput ? customInput.value : sel.value;
        grp.innerHTML = '';
        for (const model of models) {
            const opt = document.createElement('option'); {
                opt.value = model;
                opt.textContent = model;
                grp.append(opt);
            }
        }
        if (!sel.contains(grp)) sel.insertBefore(grp, sel.firstChild);
        sel.value = selected;
    };
    const grp = document.createElement('optgroup'); {
        grp.label = 'Custom Models';
        populateOptGroup();
    }
    if (provider !== 'custom' && settings[`${provider}_model`] && models.includes(settings[`${provider}_model`])) {
        sel.value = settings[`${provider}_model`];
        sel.dispatchEvent(new Event('change', { bubbles:true }));
    }
    const onInput = () => { sel.value = customInput.value; };
    let observer;
    if (customInput) {
        customInput.addEventListener('input', onInput);
        // Connecting/refreshing /models replaces all options in ST 1.18. Restore
        // only our group; observing direct children avoids a self-triggered loop.
        observer = new MutationObserver(() => {
            if (!sel.contains(grp)) populateOptGroup();
        });
        observer.observe(sel, { childList: true });
    }
    const onChange = ()=>{
        // Do not stop propagation: ST must receive the choice to use it in API
        // requests (and, for Custom, synchronize its model-ID input).
        if (settings[`${provider}_model`] != sel.value) {
            settings[`${provider}_model`] = sel.value;
            extension_settings.customModels = settings;
            saveSettingsDebounced();
        }
    };
    sel.addEventListener('change', onChange);
    mounted.set(provider, { sel, h4, input: customInput, btn, dispose() {
        observer?.disconnect();
        customInput?.removeEventListener('input', onInput);
        sel.removeEventListener('change', onChange);
        btn.remove();
        grp.remove();
    } });
}

let scheduled;
let observationRoot;
const controlsObserver = new MutationObserver(() => {
    if (scheduled !== undefined) return;
    scheduled = window.setTimeout(() => {
        scheduled = undefined;
        mountModelEditors();
    }, 100);
});
function mountModelEditors() {
    for (const [provider, models] of Object.entries(settings.provider)) mountProvider(provider, models);
    const root = document.querySelector('#custom_form')?.closest('.drawer-content') ?? document.body;
    if (root && root !== observationRoot) {
        controlsObserver.disconnect();
        observationRoot = root;
        controlsObserver.observe(root, { childList: true, subtree: true });
    }
}
// Immediate mount covers ready pages; DOM/APP_READY and scoped observation cover
// delayed initialization and replacement of the connection panel in newer ST.
mountModelEditors();
document.addEventListener('DOMContentLoaded', mountModelEditors, { once: true });
if (ST.eventSource?.on && ST.event_types?.APP_READY) {
    ST.eventSource.on(ST.event_types.APP_READY, mountModelEditors);
}
window.addEventListener('pagehide', () => {
    window.clearTimeout(scheduled);
    controlsObserver.disconnect();
    if (ST.eventSource?.removeListener && ST.event_types?.APP_READY) {
        ST.eventSource.removeListener(ST.event_types.APP_READY, mountModelEditors);
    }
    for (const item of mounted.values()) item.dispose();
    mounted.clear();
}, { once: true });
