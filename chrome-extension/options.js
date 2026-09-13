const saveButton = document.getElementById('save');
const providerSelect = document.getElementById('provider');
const apiKeyInput = document.getElementById('apiKey');
const keyHelpP = document.getElementById('keyHelp');
const modelSelect = document.getElementById('model');
const customModelGroup = document.getElementById('customModelGroup');
const customModelInput = document.getElementById('customModel');
const statusDiv = document.getElementById('status');

const PROVIDER_MODELS = {
    google: {
        models: [
            { id: 'gemma-4-31b-it', name: 'gemma-4-31b-it' },
            { id: 'gemma-4-26b-a4b-it', name: 'gemma-4-26b-a4b-it' },
            { id: 'gemini-2.5-flash-lite', name: 'gemini-2.5-flash-lite' },
            { id: 'gemini-3.5-flash-lite', name: 'gemini-3.5-flash-lite' },
            { id: 'gemini-3.1-flash-lite', name: 'gemini-3.1-flash-lite' },
            { id: 'custom', name: 'Custom Model...' }
        ],
        placeholder: 'AIzaSy...',
        helpHtml: 'Get a free key at <a href="https://aistudio.google.com" target="_blank">aistudio.google.com</a>'
    },
    openrouter: {
        models: [
            { id: 'nex-agi/nex-n2.5-mini:free', name: 'nex-agi/nex-n2.5-mini:free' },
            { id: 'liquid/lfm-2.5-2.6b:free', name: 'liquid/lfm-2.5-2.6b:free' },
            { id: 'nvidia/nemotron-3-embed-1b:free', name: 'nvidia/nemotron-3-embed-1b:free' },
            { id: 'nvidia/nemotron-3-ultra-550b-a55b:free', name: 'nvidia/nemotron-3-ultra-550b-a55b:free' },
            { id: 'google/gemma-4-26b-a4b-it:free', name: 'google/gemma-4-26b-a4b-it:free' },
            { id: 'google/gemma-4-31b-it:free', name: 'google/gemma-4-31b-it:free' },
            { id: 'nvidia/nemotron-3-super-120b-a12b:free', name: 'nvidia/nemotron-3-super-120b-a12b:free' },
            { id: 'custom', name: 'Custom Model...' }
        ],
        placeholder: 'sk-or-v1-...',
        helpHtml: 'Get a 100% free key at <a href="https://openrouter.ai/keys" target="_blank">openrouter.ai/keys</a>'
    },
    groq: {
        models: [
            { id: 'openai/gpt-oss-20b', name: 'openai/gpt-oss-20b' },
            { id: 'openai/gpt-oss-120b', name: 'openai/gpt-oss-120b' },
            { id: 'llama-3.3-70b-versatile', name: 'llama-3.3-70b-versatile' },
            { id: 'llama-3.1-8b-instant', name: 'llama-3.1-8b-instant' },
            { id: 'groq/compound-mini', name: 'groq/compound-mini' },
            { id: 'groq/compound', name: 'groq/compound' },
            { id: 'qwen/qwen3.8-27b', name: 'qwen/qwen3.8-27b' },
            { id: 'qwen/qwen3.6-27b', name: 'qwen/qwen3.6-27b' },
            { id: 'custom', name: 'Custom Model...' }
        ],
        placeholder: 'gsk_...',
        helpHtml: 'Get a 100% free key at <a href="https://console.groq.com/keys" target="_blank">console.groq.com/keys</a>'
    }
};

function updateProviderUI(selectedProvider, savedModel, savedCustomModel) {
    const config = PROVIDER_MODELS[selectedProvider] || PROVIDER_MODELS.openrouter;
    
    apiKeyInput.placeholder = config.placeholder;
    keyHelpP.innerHTML = config.helpHtml;

    modelSelect.innerHTML = config.models.map(m => `
        <option value="${m.id}">${m.name}</option>
    `).join('');

    if (savedModel === 'custom' || (savedModel && !config.models.some(m => m.id === savedModel))) {
        modelSelect.value = 'custom';
        customModelInput.value = savedCustomModel || savedModel;
        customModelGroup.style.display = 'block';
    } else if (savedModel && config.models.some(m => m.id === savedModel)) {
        modelSelect.value = savedModel;
        customModelGroup.style.display = 'none';
    } else {
        modelSelect.value = config.models[0].id;
        customModelGroup.style.display = 'none';
    }
}

function restoreOptions() {
    chrome.storage.sync.get(['provider', 'apiKey', 'model', 'customModel'], (items) => {
        const provider = items.provider || 'openrouter';
        providerSelect.value = provider;

        if (items.apiKey) apiKeyInput.value = items.apiKey;

        updateProviderUI(provider, items.model, items.customModel);
    });
}

function showStatus(message, type) {
    statusDiv.textContent = message;
    statusDiv.className = `show ${type}`;
    setTimeout(() => { 
        statusDiv.className = ''; 
    }, 3000);
}

function saveOptions() {
    const provider = providerSelect.value;
    const apiKey = apiKeyInput.value.trim();
    let model = modelSelect.value;
    let customModelValue = '';

    if (!apiKey) {
        showStatus('API Key cannot be empty.', 'error');
        return;
    }

    if (model === 'custom') {
        customModelValue = customModelInput.value.trim();
        if (!customModelValue) {
            showStatus('Custom Model ID cannot be empty.', 'error');
            return;
        }
        // Save 'custom' as the model type and the actual value in customModel
    }

    saveButton.textContent = 'Saving...';
    
    chrome.storage.sync.set({
        provider: provider,
        apiKey: apiKey,
        model: model,
        customModel: customModelValue
    }, () => {
        saveButton.textContent = 'Save Settings';
        showStatus('Settings saved successfully!', 'success');
    });
}

providerSelect.addEventListener('change', () => {
    updateProviderUI(providerSelect.value, null, null);
});

modelSelect.addEventListener('change', () => {
    if (modelSelect.value === 'custom') {
        customModelGroup.style.display = 'block';
        customModelInput.focus();
    } else {
        customModelGroup.style.display = 'none';
    }
});

document.addEventListener('DOMContentLoaded', restoreOptions);
saveButton.addEventListener('click', saveOptions);