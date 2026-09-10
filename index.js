import { saveSettingsDebounced } from '../../../../script.js';
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

// old popups, ancient ST
let popupCaller;
let popupType;
let popupResult;
try {
    const popup = await import('../../../popup.js');
    popupCaller = popup.callGenericPopup;
    popupType = popup.POPUP_TYPE;
    popupResult = popup.POPUP_RESULT;
} catch {
    popupCaller = (await import('../../../../script.js')).callPopup;
    popupType = {
        TEXT: 1,
    };
    popupResult = {
        AFFIRMATIVE: 1,
    };
}

for (const [provider, models] of Object.entries(settings.provider)) {
    const sel = /**@type {HTMLSelectElement}*/(document.querySelector(`#model_${provider}_select`));
    const customInput = provider === 'custom' ? document.querySelector('#custom_model_id') : null;
    // Custom's select has a different wrapper: attach next to "Enter a Model ID",
    // not the API URL/key heading or the hidden OpenAI connection form.
    const h4 = provider === 'custom'
        ? document.querySelector('#custom_form h4[data-i18n="Enter a Model ID"]')
            ?? customInput?.closest('.flex-container')?.previousElementSibling
        : sel?.parentElement?.querySelector('h4');
    if (!sel || !h4?.matches('h4') || (provider === 'custom' && !customInput)) {
        console.warn(`[Custom Models] Skipping unavailable ${provider} model controls.`);
        continue;
    }
    if (h4.querySelector('.stcm--btn')) continue;
    const btn = document.createElement('button'); {
        btn.type = 'button';
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
            const prom = popupCaller(dom, popupType.TEXT, null, { okButton: 'Save' });
            const result = await prom;
            if (result == popupResult.AFFIRMATIVE) {
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
    if (customInput) {
        customInput.addEventListener('input', () => { sel.value = customInput.value; });
        // Connecting/refreshing /models replaces all options in ST 1.18. Restore
        // only our group; observing direct children avoids a self-triggered loop.
        const observer = new MutationObserver(() => {
            if (!sel.contains(grp)) populateOptGroup();
        });
        observer.observe(sel, { childList: true });
        window.addEventListener('pagehide', () => observer.disconnect(), { once: true });
    }
    sel.addEventListener('change', ()=>{
        // Do not stop propagation: ST must receive the choice to use it in API
        // requests (and, for Custom, synchronize its model-ID input).
        if (settings[`${provider}_model`] != sel.value) {
            settings[`${provider}_model`] = sel.value;
            extension_settings.customModels = settings;
            saveSettingsDebounced();
        }
    });
}
