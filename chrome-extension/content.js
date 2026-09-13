// File: content.js - Native Shadow DOM UI for PromptGod (Zero blank screens, true glassmorphic overlay)

let activePromptElement = null;
let originalPrompt = '';
let shadowHost = null;
let shadowRoot = null;
let savedSelectionStart = null;
let savedSelectionEnd = null;
let savedRange = null;

let lastContextElement = null;
let lastFocusedElement = null;

document.addEventListener('contextmenu', (e) => {
    lastContextElement = e.target;
}, true);

document.addEventListener('focusin', (e) => {
    if (e.target && (e.target.isContentEditable || e.target.tagName === 'TEXTAREA' || e.target.tagName === 'INPUT')) {
        lastFocusedElement = e.target;
        chrome.runtime.sendMessage({ type: "PROMPTGOD_FOCUS_EDITABLE" }).catch(() => {});
    }
}, true);

function triggerPromptGod(triggerInfo = {}) {
    let activeEl = document.activeElement;
    
    // If body is active, the user might have used context menu or clicked away before using shortcut
    if (activeEl === document.body) {
        if (lastContextElement) activeEl = lastContextElement;
        else if (lastFocusedElement) activeEl = lastFocusedElement;
    }
    
    // For WhatsApp and React apps, we must traverse up to find the contenteditable container
    if (activeEl && !activeEl.isContentEditable && activeEl.tagName !== 'TEXTAREA' && activeEl.tagName !== 'INPUT') {
        const editableParent = activeEl.closest('[contenteditable="true"]');
        if (editableParent) {
            activeEl = editableParent;
        }
    }

    const isValidTarget = activeEl && (
        activeEl.tagName === 'TEXTAREA' || 
        (activeEl.tagName === 'INPUT' && !/checkbox|radio|submit|button|file|color/.test(activeEl.type)) || 
        activeEl.isContentEditable
    );
    
    const contextSelection = triggerInfo.selectionText || '';
    let promptValue = '';

    if (contextSelection && triggerInfo.source === 'contextMenu') {
        promptValue = contextSelection;
    }

    if (!promptValue && activeEl && (activeEl.tagName === 'TEXTAREA' || activeEl.tagName === 'INPUT')) {
        const start = activeEl.selectionStart;
        const end = activeEl.selectionEnd;
        if (typeof start === 'number' && typeof end === 'number' && start !== end) {
            promptValue = activeEl.value.substring(start, end);
        } else {
            promptValue = activeEl.value || '';
        }
    }

    if (!promptValue) {
        const sel = window.getSelection();
        if (sel && sel.toString()) {
            promptValue = sel.toString();
        }
    }

    if (!promptValue && activeEl) {
        promptValue = activeEl.value !== undefined ? activeEl.value : (activeEl.innerText || activeEl.textContent || '');
    }

    activePromptElement = isValidTarget ? activeEl : null;
    originalPrompt = promptValue ? promptValue.trim() : '';
    
    if (activePromptElement && (activePromptElement.tagName === 'TEXTAREA' || activePromptElement.tagName === 'INPUT')) {
        savedSelectionStart = activePromptElement.selectionStart;
        savedSelectionEnd = activePromptElement.selectionEnd;
    } else {
        const sel = window.getSelection();
        if (sel && sel.rangeCount > 0) {
            savedRange = sel.getRangeAt(0).cloneRange();
        }
    }
    
    openModal();
    startSiteAnalysis();
}

// Listen for invocation from background script
chrome.runtime.onMessage.addListener((request) => {
    if (request.type === "PROMPTGOD_TRIGGER") {
        triggerPromptGod(request);
    }
});

function startSiteAnalysis() {
    // 1. Check if extension context was invalidated (extension reloaded while tab was open)
    if (typeof chrome === 'undefined' || !chrome.runtime || !chrome.runtime.id) {
        showErrorState("PromptGod extension was updated! Please refresh this browser tab (F5) to re-sync.");
        return;
    }

    showLoadingState("Analyzing website features...");

    const timeoutTimer = setTimeout(() => {
        showErrorState("Request timed out (45s). Please check your API key & model settings in extension Options.");
    }, 45000);

    try {
        chrome.runtime.sendMessage({
            type: "PROMPTGOD_ANALYZE_SITE",
            url: window.location.href
        }, (response) => {
            clearTimeout(timeoutTimer);
            if (!shadowRoot) return;

            if (chrome.runtime.lastError) {
                const msg = chrome.runtime.lastError.message || '';
                if (msg.includes("invalidated")) {
                    showErrorState("PromptGod was updated! Please refresh this browser tab (F5) to re-sync.");
                } else {
                    showErrorState(msg || "Extension communication error. Please reload page.");
                }
                return;
            }

            if (response?.error) {
                showErrorState(response.error);
            } else if (response?.success && response.data?.functions) {
                showFunctionsState(response.data.functions);
            } else {
                showErrorState("Could not determine site features. Please check your options.");
            }
        });
    } catch (e) {
        clearTimeout(timeoutTimer);
        showErrorState("PromptGod extension was updated! Please refresh this browser tab (F5) to re-sync.");
    }
}

function removeModalDOM() {
    window.removeEventListener('keydown', handleGlobalKeydown, true);
    if (shadowHost) {
        shadowHost.remove();
        shadowHost = null;
        shadowRoot = null;
    }
}

function destroyModal() {
    removeModalDOM();
    if (activePromptElement) {
        try { activePromptElement.focus(); } catch (e) {}
    }
    activePromptElement = null;
    originalPrompt = '';
    savedSelectionStart = null;
    savedSelectionEnd = null;
    savedRange = null;
}

function openModal() {
    removeModalDOM();

    shadowHost = document.createElement('div');
    shadowHost.id = 'promptgod-shadow-host';
    shadowHost.style.cssText = 'all: initial; position: fixed; top: 0; left: 0; width: 100vw; height: 100vh; z-index: 2147483647; pointer-events: none;';

    shadowRoot = shadowHost.attachShadow({ mode: 'open' });

    // Inject scoped styles and skeleton
    shadowRoot.innerHTML = `
        <style>
            :host {
                font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
                color-scheme: dark;
            }

            * {
                box-sizing: border-box;
                margin: 0;
                padding: 0;
            }

            .pg-backdrop {
                position: fixed;
                inset: 0;
                background: rgba(15, 23, 42, 0.45);
                backdrop-filter: blur(8px);
                -webkit-backdrop-filter: blur(8px);
                display: flex;
                align-items: center;
                justify-content: center;
                padding: 20px;
                pointer-events: auto;
                opacity: 0;
                animation: pgFadeIn 0.2s cubic-bezier(0.16, 1, 0.3, 1) forwards;
            }

            .pg-card {
                background: rgba(15, 23, 42, 0.85);
                backdrop-filter: blur(20px);
                -webkit-backdrop-filter: blur(20px);
                border: 1px solid rgba(255, 255, 255, 0.12);
                border-radius: 16px;
                width: 100%;
                max-width: 480px;
                box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.6), 0 0 0 1px rgba(255, 255, 255, 0.08);
                color: #F8FAFC;
                overflow: hidden;
                transform: scale(0.96) translateY(-8px);
                opacity: 0;
                animation: pgCardIn 0.25s cubic-bezier(0.16, 1, 0.3, 1) forwards;
                display: flex;
                flex-direction: column;
            }

            @keyframes pgFadeIn {
                to { opacity: 1; }
            }

            @keyframes pgCardIn {
                to {
                    transform: scale(1) translateY(0);
                    opacity: 1;
                }
            }

            .pg-header {
                display: flex;
                align-items: center;
                justify-content: space-between;
                padding: 14px 18px;
                border-bottom: 1px solid rgba(255, 255, 255, 0.08);
            }

            .pg-brand {
                display: flex;
                align-items: center;
                gap: 10px;
                font-weight: 600;
                font-size: 15px;
                letter-spacing: -0.01em;
                color: #F8FAFC;
            }

            .pg-brand svg {
                color: #3B82F6;
            }

            .pg-badge {
                font-size: 11px;
                font-weight: 500;
                padding: 2px 8px;
                border-radius: 9999px;
                background: rgba(37, 99, 235, 0.2);
                color: #60A5FA;
                border: 1px solid rgba(37, 99, 235, 0.3);
            }

            .pg-close-btn {
                background: transparent;
                border: none;
                color: #94A3B8;
                cursor: pointer;
                border-radius: 6px;
                padding: 4px;
                display: flex;
                align-items: center;
                justify-content: center;
                transition: all 0.15s ease;
            }

            .pg-close-btn:hover {
                background: rgba(255, 255, 255, 0.1);
                color: #F8FAFC;
            }

            .pg-body {
                padding: 20px;
                min-height: 120px;
                display: flex;
                flex-direction: column;
                justify-content: center;
            }

            .pg-loader-wrap {
                display: flex;
                flex-direction: column;
                align-items: center;
                justify-content: center;
                gap: 14px;
                padding: 12px 0;
            }

            .pg-spinner {
                width: 32px;
                height: 32px;
                border: 3px solid rgba(255, 255, 255, 0.12);
                border-top-color: #3B82F6;
                border-radius: 50%;
                animation: pgSpin 0.75s linear infinite;
            }

            @keyframes pgSpin {
                to { transform: rotate(360deg); }
            }

            .pg-loader-text {
                font-size: 14px;
                color: #CBD5E1;
                font-weight: 500;
            }

            .pg-section-title {
                font-size: 13px;
                font-weight: 600;
                color: #94A3B8;
                text-transform: uppercase;
                letter-spacing: 0.05em;
                margin-bottom: 12px;
            }

            .pg-grid {
                display: grid;
                grid-template-columns: repeat(auto-fill, minmax(130px, 1fr));
                gap: 10px;
            }

            .pg-btn {
                background: rgba(255, 255, 255, 0.06);
                border: 1px solid rgba(255, 255, 255, 0.1);
                border-radius: 10px;
                padding: 12px 14px;
                color: #F8FAFC;
                font-size: 14px;
                font-weight: 500;
                cursor: pointer;
                display: flex;
                align-items: center;
                justify-content: space-between;
                gap: 8px;
                transition: all 0.15s cubic-bezier(0.16, 1, 0.3, 1);
                text-align: left;
                user-select: none;
            }

            .pg-btn:hover, .pg-btn.focused {
                background: #2563EB;
                border-color: #3B82F6;
                transform: translateY(-1px);
                box-shadow: 0 4px 14px rgba(37, 99, 235, 0.35);
                outline: none;
            }

            .pg-btn:active {
                transform: translateY(0);
            }

            .pg-error-card {
                background: rgba(239, 68, 68, 0.12);
                border: 1px solid rgba(239, 68, 68, 0.25);
                border-radius: 10px;
                padding: 14px 16px;
                display: flex;
                align-items: flex-start;
                gap: 12px;
                color: #FCA5A5;
                font-size: 14px;
                line-height: 1.4;
            }

            .pg-error-card svg {
                flex-shrink: 0;
                color: #EF4444;
                margin-top: 1px;
            }

            .pg-success-card {
                display: flex;
                flex-direction: column;
                align-items: center;
                gap: 10px;
                padding: 16px;
                color: #4ADE80;
                font-size: 15px;
                font-weight: 500;
            }

            .pg-footer {
                padding: 10px 18px;
                background: rgba(0, 0, 0, 0.25);
                border-top: 1px solid rgba(255, 255, 255, 0.06);
                display: flex;
                align-items: center;
                gap: 12px;
                font-size: 12px;
                color: #64748B;
            }

            .pg-footer kbd {
                background: rgba(255, 255, 255, 0.08);
                border: 1px solid rgba(255, 255, 255, 0.12);
                border-radius: 4px;
                padding: 2px 6px;
                font-family: inherit;
                font-size: 11px;
                color: #94A3B8;
            }

            .pg-preview-textarea {
                width: 100%;
                background: rgba(0, 0, 0, 0.2);
                border: 1px solid rgba(255, 255, 255, 0.1);
                border-radius: 10px;
                padding: 12px;
                color: #F8FAFC;
                font-family: inherit;
                font-size: 14px;
                line-height: 1.5;
                resize: vertical;
                margin-bottom: 16px;
                min-height: 100px;
                max-height: 300px;
            }

            .pg-preview-textarea:focus {
                outline: none;
                border-color: #3B82F6;
                box-shadow: 0 0 0 2px rgba(37, 99, 235, 0.2);
            }

            .pg-action-buttons {
                display: flex;
                gap: 12px;
                justify-content: flex-end;
            }

            .pg-btn-primary {
                background: #2563EB;
                color: white;
                border: none;
                padding: 10px 16px;
                border-radius: 8px;
                font-size: 14px;
                font-weight: 500;
                cursor: pointer;
                display: flex;
                align-items: center;
                gap: 6px;
                transition: background 0.15s;
            }

            .pg-btn-primary:hover, .pg-btn-primary:focus {
                background: #3B82F6;
                outline: none;
            }

            .pg-btn-secondary {
                background: rgba(255, 255, 255, 0.08);
                color: #CBD5E1;
                border: 1px solid rgba(255, 255, 255, 0.1);
                padding: 10px 16px;
                border-radius: 8px;
                font-size: 14px;
                font-weight: 500;
                cursor: pointer;
                display: flex;
                align-items: center;
                gap: 6px;
                transition: all 0.15s;
            }

            .pg-btn-secondary:hover, .pg-btn-secondary:focus {
                background: rgba(255, 255, 255, 0.15);
                color: white;
                outline: none;
            }
        </style>

        <div class="pg-backdrop" id="pg-backdrop">
            <div class="pg-card" id="pg-card" role="dialog" aria-modal="true" tabindex="-1">
                <div class="pg-header">
                    <div class="pg-brand">
                        <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>
                        <span>PromptGod</span>
                        <span class="pg-badge">AI Assistant</span>
                    </div>
                    <button class="pg-close-btn" id="pg-close-btn" title="Close (Esc)">
                        <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
                    </button>
                </div>
                <div class="pg-body" id="pg-body">
                    <!-- Dynamic state injected here -->
                </div>
                <div class="pg-footer">
                    <span><kbd>Esc</kbd> close</span>
                    <span><kbd>↑↓</kbd> navigate</span>
                    <span><kbd>↵</kbd> select</span>
                </div>
            </div>
        </div>
    `;

    document.documentElement.appendChild(shadowHost);

    // Click outside to dismiss
    const backdrop = shadowRoot.getElementById('pg-backdrop');
    backdrop.addEventListener('click', (e) => {
        if (e.target === backdrop) {
            destroyModal();
        }
    });

    // Close button
    const closeBtn = shadowRoot.getElementById('pg-close-btn');
    closeBtn.addEventListener('click', () => destroyModal());

    // Keyboard handlers
    window.addEventListener('keydown', handleGlobalKeydown, true);
}

function handleGlobalKeydown(e) {
    if (!shadowRoot) return;

    if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        destroyModal();
        return;
    }

    const buttons = Array.from(shadowRoot.querySelectorAll('.pg-btn'));
    if (buttons.length === 0) return;

    const activeIndex = buttons.findIndex(b => b.classList.contains('focused') || b === shadowRoot.activeElement);

    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
        e.preventDefault();
        e.stopPropagation();
        const nextIndex = activeIndex === -1 ? 0 : (activeIndex + 1) % buttons.length;
        buttons.forEach(b => b.classList.remove('focused'));
        buttons[nextIndex].classList.add('focused');
        buttons[nextIndex].focus();
    } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
        e.preventDefault();
        e.stopPropagation();
        const prevIndex = activeIndex <= 0 ? buttons.length - 1 : activeIndex - 1;
        buttons.forEach(b => b.classList.remove('focused'));
        buttons[prevIndex].classList.add('focused');
        buttons[prevIndex].focus();
    } else if (e.key === 'Enter') {
        if (activeIndex !== -1 && buttons[activeIndex]) {
            e.preventDefault();
            e.stopPropagation();
            buttons[activeIndex].click();
        }
    }
}

function showLoadingState(message = "Working...") {
    if (!shadowRoot) return;
    const body = shadowRoot.getElementById('pg-body');
    body.innerHTML = `
        <div class="pg-loader-wrap">
            <div class="pg-spinner"></div>
            <div class="pg-loader-text">${escapeHtml(message)}</div>
        </div>
    `;
}

function showErrorState(errorMsg) {
    if (!shadowRoot) return;
    const body = shadowRoot.getElementById('pg-body');
    body.innerHTML = `
        <div class="pg-error-card">
            <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="8" x2="12" y2="12"></line><line x1="12" y1="16" x2="12.01" y2="16"></line></svg>
            <div>${escapeHtml(errorMsg)}</div>
        </div>
    `;
}

function showFunctionsState(functions) {
    if (!shadowRoot) return;
    const body = shadowRoot.getElementById('pg-body');
    
    let buttonsHtml = functions.map(func => `
        <button class="pg-btn" data-function="${escapeHtml(func)}">
            <span>${escapeHtml(func)}</span>
            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="opacity: 0.5;"><polyline points="9 18 15 12 9 6"></polyline></svg>
        </button>
    `).join('');

    body.innerHTML = `
        <div class="pg-section-title" style="margin-bottom: 6px;">Your Draft Prompt</div>
        <textarea id="pg-draft-input" class="pg-preview-textarea" style="height: 60px; margin-bottom: 16px; font-size: 13px; padding: 10px;" placeholder="Type or paste your prompt here..."></textarea>
        
        <div class="pg-section-title">Select Enhancement Mode</div>
        <div class="pg-grid">
            ${buttonsHtml}
        </div>
    `;

    const draftInput = shadowRoot.getElementById('pg-draft-input');
    draftInput.value = originalPrompt;



    const buttons = shadowRoot.querySelectorAll('.pg-btn');
    buttons.forEach((btn, index) => {
        if (index === 0) btn.classList.add('focused');
        
        btn.addEventListener('click', () => {
            const func = btn.dataset.function;
            const finalDraft = draftInput.value.trim();
            
            if (!finalDraft) {
                alert("Please enter a draft prompt to enhance!");
                return;
            }
            
            showLoadingState(`Enhancing prompt with ${func}...`);

            // Check context before sending
            if (typeof chrome === 'undefined' || !chrome.runtime || !chrome.runtime.id) {
                showErrorState("PromptGod extension was updated! Please refresh this browser tab (F5) to re-sync.");
                return;
            }

            const timeoutTimer = setTimeout(() => {
                showErrorState("Enhancement timed out (60s). Please retry or check your API key.");
            }, 60000);

            try {
                const port = chrome.runtime.connect({ name: 'promptgod-stream' });
                
                port.postMessage({
                    type: "PROMPTGOD_ENHANCE_PROMPT_STREAM",
                    url: window.location.href,
                    selectedFunction: func,
                    prompt: finalDraft
                });

                // Show the UI immediately with empty textarea for streaming
                body.innerHTML = `
                    <div class="pg-section-title">Generating Enhanced Prompt...</div>
                    <textarea class="pg-preview-textarea" id="pg-preview-text" rows="5" spellcheck="false"></textarea>
                    <div class="pg-action-buttons" id="pg-action-container" style="display: none; display: flex; gap: 8px;">
                        <button class="pg-btn-secondary" id="pg-btn-copy" style="flex: 1;">
                            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>
                            Copy
                        </button>
                        <button class="pg-btn-secondary" id="pg-btn-regenerate" style="flex: 1;">
                            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="1 4 1 10 7 10"></polyline><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"></path></svg>
                            Regenerate
                        </button>
                        <button class="pg-btn-primary" id="pg-btn-confirm" style="flex: 2;">
                            Confirm & Paste
                            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14"></path><path d="m12 5 7 7-7 7"></path></svg>
                        </button>
                    </div>
                `;
                
                const previewTextArea = shadowRoot.getElementById('pg-preview-text');
                const actionContainer = shadowRoot.getElementById('pg-action-container');
                const confirmBtn = shadowRoot.getElementById('pg-btn-confirm');
                const regenerateBtn = shadowRoot.getElementById('pg-btn-regenerate');
                const copyBtn = shadowRoot.getElementById('pg-btn-copy');

                copyBtn.addEventListener('click', () => {
                    const finalText = previewTextArea.value;
                    navigator.clipboard.writeText(finalText).then(() => {
                        const originalHtml = copyBtn.innerHTML;
                        copyBtn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg> Copied!`;
                        copyBtn.style.color = '#4ADE80';
                        copyBtn.style.borderColor = '#4ADE80';
                        setTimeout(() => {
                            copyBtn.innerHTML = originalHtml;
                            copyBtn.style.color = '';
                            copyBtn.style.borderColor = '';
                        }, 2000);
                    });
                });

                confirmBtn.addEventListener('click', () => {
                    const finalText = previewTextArea.value;
                    
                    // Hide the modal visually first so focus isn't trapped
                    if (shadowHost) shadowHost.style.display = 'none';
                    
                    if (activePromptElement) {
                        replaceTextRobustly(activePromptElement, finalText);
                    }
                    
                    setTimeout(() => destroyModal(), 100);
                });

                regenerateBtn.addEventListener('click', () => {
                    port.disconnect();
                    btn.click();
                });

                port.onMessage.addListener((msg) => {
                    clearTimeout(timeoutTimer);
                    
                    if (msg.type === "STREAM_CHUNK") {
                        previewTextArea.value += msg.chunk;
                        previewTextArea.scrollTop = previewTextArea.scrollHeight;
                    } else if (msg.type === "STREAM_DONE") {
                        actionContainer.style.display = 'flex';
                        body.querySelector('.pg-section-title').textContent = 'Review Enhanced Prompt';
                        confirmBtn.focus();
                        port.disconnect();
                    } else if (msg.type === "STREAM_ERROR") {
                        showErrorState(msg.error);
                        port.disconnect();
                    }
                });

                port.onDisconnect.addListener(() => {
                    if (chrome.runtime.lastError) {
                        const msg = chrome.runtime.lastError.message || '';
                        if (msg.includes("invalidated")) {
                            showErrorState("PromptGod was updated! Please refresh this browser tab (F5) to re-sync.");
                        }
                    }
                });
                
            } catch (e) {
                clearTimeout(timeoutTimer);
                showErrorState("PromptGod extension was updated! Please refresh this browser tab (F5) to re-sync.");
            }
        });
    });
}

function replaceTextRobustly(element, newText) {
    if (!element || !newText) return false;
    
    // Make sure the original target is still connected to the document.
    if (!element.isConnected) {
        console.warn("[PromptGod] Original prompt element is no longer connected.");
        return false;
    }
    
    if (element.tagName === 'TEXTAREA' || element.tagName === 'INPUT') {
        try {
            element.focus();
            const start = savedSelectionStart !== null ? savedSelectionStart : element.selectionStart;
            const end = savedSelectionEnd !== null ? savedSelectionEnd : element.selectionEnd;
            const proto = element.tagName === 'INPUT' ? window.HTMLInputElement.prototype : window.HTMLTextAreaElement.prototype;
            const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
            
            if (!setter) {
                console.warn("[PromptGod] Could not find native value setter.");
                return false;
            }
            
            const currentValue = element.value || '';
            let updatedValue;
            let cursorPosition;
            
            if (typeof start === 'number' && typeof end === 'number' && start !== end) {
                updatedValue = currentValue.substring(0, start) + newText + currentValue.substring(end);
                cursorPosition = start + newText.length;
            } else {
                updatedValue = newText;
                cursorPosition = newText.length;
            }
            
            setter.call(element, updatedValue);
            
            try {
                element.setSelectionRange(cursorPosition, cursorPosition);
            } catch (_) {}
            
            element.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: newText }));
            element.dispatchEvent(new Event('change', { bubbles: true }));
            return true;
        } catch (error) {
            console.error("[PromptGod] Input replacement failed:", error);
            return false;
        }
    }
    
    if (element.isContentEditable) {
        try {
            element.focus();
            const selection = window.getSelection();
            if (!selection) return false;
            
            selection.removeAllRanges();
            
            if (savedRange && !savedRange.collapsed && savedRange.startContainer.isConnected && savedRange.endContainer.isConnected) {
                selection.addRange(savedRange);
            } else {
                const range = document.createRange();
                range.selectNodeContents(element);
                selection.addRange(range);
            }
            
            // Best option for many browser editors.
            const inserted = document.execCommand('insertText', false, newText);
            if (inserted) {
                return true;
            }
            
            console.warn("[PromptGod] execCommand(insertText) was rejected.");
            return false;
        } catch (error) {
            console.error("[PromptGod] Contenteditable replacement failed:", error);
            return false;
        }
    }
    return false;
}

function escapeHtml(str) {
    if (!str) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

