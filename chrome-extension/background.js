// --- Context Menu & Shortcut Setup ---
chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: "promptgod-enhance",
      title: "Enhance with PromptGod",
      contexts: ["editable", "selection"]
    });
  });
});

const lastFocusedFrameByTab = new Map();

chrome.runtime.onMessage.addListener((request, sender) => {
    if (request.type === "PROMPTGOD_FOCUS_EDITABLE" && sender.tab && sender.tab.id != null) {
        lastFocusedFrameByTab.set(sender.tab.id, sender.frameId || 0);
    }
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === "promptgod-enhance" && tab && tab.id) {
      chrome.tabs.sendMessage(
          tab.id, 
          { 
              type: "PROMPTGOD_TRIGGER", 
              source: "contextMenu", 
              selectionText: info.selectionText || "", 
              editable: !!info.editable, 
              frameId: info.frameId || 0 
          }, 
          { frameId: info.frameId || 0 }
      ).catch(() => {});
  }
});

chrome.commands.onCommand.addListener((command, tab) => {
  if (command === "trigger-promptgod" && tab && tab.id) {
    const frameId = lastFocusedFrameByTab.get(tab.id) || 0;
    chrome.tabs.sendMessage(tab.id, { type: "PROMPTGOD_TRIGGER", source: "action" }, { frameId }).catch(() => {});
  }
});

chrome.action.onClicked.addListener((tab) => {
    if (tab && tab.id) {
        const frameId = lastFocusedFrameByTab.get(tab.id) || 0;
        chrome.tabs.sendMessage(tab.id, { type: "PROMPTGOD_TRIGGER", source: "action" }, { frameId }).catch(() => {});
    }
});

// --- HARDCODED FIREBASE WEB CONFIG ---
const FIREBASE_CONFIG = {
  apiKey: "AIzaSyCxKHdhKiEX-_S6GW75GcYH-kO06lawWHg",
  authDomain: "promptgodextension.firebaseapp.com",
  projectId: "promptgodextension",
  storageBucket: "promptgodextension.firebasestorage.app",
  messagingSenderId: "381687471346",
  appId: "1:381687471346:web:14c7c5ad68d92a0f55c46b",
  measurementId: "G-42DEZ2PYFW"
};

// --- Utilities ---
function cleanDomain(urlStr) {
    try {
        const url = new URL(urlStr);
        let domain = url.hostname;
        domain = domain.replace(/^www\./i, '');
        return domain;
    } catch (e) {
        return (urlStr || '').replace(/^https?:\/\//i, '').split('/')[0].replace(/^www\./i, '') || 'general_site';
    }
}

function extractJsonFromText(text) {
    if (!text) return null;
    
    const content = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/i) 
        ? text.match(/```(?:json)?\s*([\s\S]*?)\s*```/i)[1] 
        : text;
    
    try {
        const parsed = JSON.parse(content.trim());
        if (parsed && typeof parsed === 'object') return parsed;
    } catch (_) {}
    
    const braceMatch = content.match(/\{[\s\S]*\}/);
    if (braceMatch) {
        try {
            const parsed = JSON.parse(braceMatch[0]);
            if (parsed && typeof parsed === 'object') return parsed;
        } catch (_) {}
    }
    
    // Fallback for Agent 1 function lists
    const items = content.split('\n')
        .map(line => line.replace(/^[\s*\-\d.]+\s*/, '').trim())
        .filter(line => line.length > 2 && line.length < 50 && !line.includes('{') && !line.includes('}'));
        
    if (items.length > 0) {
        return { functions: items.slice(0, 5) };
    }
    
    return null;
}

// --- Firestore REST API Client (Hardcoded Web App Credentials) ---
function firestoreFieldsToJs(fields) {
    if (!fields) return null;
    const result = {};
    for (const key in fields) {
        const valObj = fields[key];
        if (valObj.stringValue !== undefined) {
            result[key] = valObj.stringValue;
        } else if (valObj.arrayValue !== undefined) {
            const arr = valObj.arrayValue.values || [];
            result[key] = arr.map(v => v.stringValue || v.integerValue || v.booleanValue || v);
        } else if (valObj.integerValue !== undefined) {
            result[key] = parseInt(valObj.integerValue, 10);
        } else if (valObj.booleanValue !== undefined) {
            result[key] = valObj.booleanValue;
        } else if (valObj.mapValue !== undefined) {
            result[key] = firestoreFieldsToJs(valObj.mapValue.fields);
        }
    }
    return result;
}

function jsToFirestoreFields(obj) {
    const fields = {};
    for (const key in obj) {
        const val = obj[key];
        if (typeof val === 'string') {
            fields[key] = { stringValue: val };
        } else if (typeof val === 'number') {
            fields[key] = { integerValue: val.toString() };
        } else if (typeof val === 'boolean') {
            fields[key] = { booleanValue: val };
        } else if (Array.isArray(val)) {
            fields[key] = {
                arrayValue: {
                    values: val.map(v => ({ stringValue: String(v) }))
                }
            };
        } else if (val && typeof val === 'object') {
            fields[key] = {
                mapValue: {
                    fields: jsToFirestoreFields(val)
                }
            };
        }
    }
    return fields;
}

async function getFirestoreDoc(collection, docId) {
    if (!FIREBASE_CONFIG.projectId) return null;
    try {
        const url = `https://firestore.googleapis.com/v1/projects/${FIREBASE_CONFIG.projectId}/databases/(default)/documents/${collection}/${encodeURIComponent(docId)}?key=${FIREBASE_CONFIG.apiKey}`;
        const res = await fetch(url);
        if (!res.ok) return null;
        const data = await res.json();
        return firestoreFieldsToJs(data.fields);
    } catch (e) {
        console.warn("Firestore GET error:", e);
        return null;
    }
}

async function setFirestoreDoc(collection, docId, dataObj) {
    if (!FIREBASE_CONFIG.projectId) return;
    try {
        const url = `https://firestore.googleapis.com/v1/projects/${FIREBASE_CONFIG.projectId}/databases/(default)/documents/${collection}/${encodeURIComponent(docId)}?key=${FIREBASE_CONFIG.apiKey}`;
        const fields = jsToFirestoreFields(dataObj);
        await fetch(url, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ fields })
        });
    } catch (e) {
        console.warn("Firestore PATCH error:", e);
    }
}

function sanitizeModel(provider, model) {
    const p = provider || 'openrouter';
    let m = model;
    
    // Only sanitize known deprecated slugs. Never override custom models based on substrings.
    if (p === 'openrouter') {
        if (!m || m === 'google/gemma-2-27b-it:free' || m === 'google/gemma-2-9b-it:free') {
            m = 'openrouter/free';
        }
    } else if (p === 'google') {
        if (!m) {
            m = 'gemini-1.5-flash';
        }
    } else if (p === 'groq') {
        if (!m) {
            m = 'gemma2-9b-it';
        }
    }
    return m;
}

// Unified Multi-Provider AI Fetcher
async function callAIProvider(prompt, provider, model, apiKey) {
    const activeProvider = provider || 'openrouter';
    const activeModel = sanitizeModel(activeProvider, model);
    
    console.log(`[PromptGod] callAIProvider Invoked - Provider: ${activeProvider}, Model: ${activeModel}`);

    if (activeProvider === 'google') {
        const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${activeModel}:generateContent?key=${apiKey}`;
        console.log(`[PromptGod] Sending POST request to Google: ${endpoint}`);
        const response = await fetch(endpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                contents: [{ parts: [{ text: prompt }] }],
                generationConfig: { temperature: 0.7 }
            })
        });

        if (!response.ok) {
            const errText = await response.text();
            console.error(`[PromptGod] Google API Error (${response.status}):`, errText);
            let errMsg = `Google API Error (${response.status})`;
            try {
                const errJson = JSON.parse(errText);
                if (errJson.error && errJson.error.message) errMsg += `: ${errJson.error.message}`;
                else errMsg += `: ${errText}`;
            } catch (_) {
                errMsg += `: ${errText}`;
            }
            throw new Error(errMsg);
        }

        const data = await response.json();
        console.log(`[PromptGod] Google API Response:`, data);
        if (data.candidates && data.candidates.length > 0 && data.candidates[0].content?.parts?.length > 0) {
            return data.candidates[0].content.parts[0].text;
        }
        throw new Error("No response returned from Google AI Studio.");
    } 
    
    else if (activeProvider === 'openrouter' || activeProvider === 'groq') {
        const endpoint = activeProvider === 'openrouter' 
            ? 'https://openrouter.ai/api/v1/chat/completions'
            : 'https://api.groq.com/openai/v1/chat/completions';

        const headers = {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiKey}`
        };

        if (activeProvider === 'openrouter') {
            headers['HTTP-Referer'] = 'https://github.com/promptgod';
            headers['X-Title'] = 'PromptGod Extension';
        }

        console.log(`[PromptGod] Sending POST request to ${activeProvider.toUpperCase()}: ${endpoint}`);
        const response = await fetch(endpoint, {
            method: 'POST',
            headers: headers,
            body: JSON.stringify({
                model: activeModel,
                messages: [
                    { role: 'user', content: prompt }
                ],
                temperature: 0.7
            })
        });

        if (!response.ok) {
            const errText = await response.text();
            console.error(`[PromptGod] ${activeProvider.toUpperCase()} API Error (${response.status}):`, errText);
            let errMsg = `${activeProvider.toUpperCase()} API Error (${response.status})`;
            try {
                const errJson = JSON.parse(errText);
                if (errJson.error && errJson.error.message) errMsg += `: ${errJson.error.message}`;
                else errMsg += `: ${errText}`;
            } catch (_) {
                errMsg += `: ${errText}`;
            }
            throw new Error(errMsg);
        }

        const data = await response.json();
        console.log(`[PromptGod] ${activeProvider.toUpperCase()} API Response:`, data);
        if (data.choices && data.choices.length > 0 && data.choices[0].message?.content) {
            return data.choices[0].message.content;
        }
        throw new Error(`No response returned from ${activeProvider}.`);
    }

    throw new Error(`Unsupported AI Provider: ${activeProvider}`);
}

// Simple SSE parser
async function parseSSE(response, onData) {
    const reader = response.body.getReader();
    const decoder = new TextDecoder("utf-8");
    let buffer = "";
    while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        
        let lines = buffer.split('\n');
        buffer = lines.pop(); // keep last incomplete line
        
        for (let line of lines) {
            line = line.trim();
            if (line.startsWith('data:')) {
                const dataStr = line.slice(5).trim();
                if (dataStr === '[DONE]') continue;
                try {
                    const data = JSON.parse(dataStr);
                    onData(data);
                } catch (e) {}
            }
        }
    }
}

// Unified Multi-Provider AI Fetcher (Streaming)
async function callAIProviderStream(systemText, userText, provider, model, apiKey, onChunk) {
    const activeProvider = provider || 'openrouter';
    const activeModel = sanitizeModel(activeProvider, model);
    
    if (activeProvider === 'google') {
        const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${activeModel}:streamGenerateContent?alt=sse&key=${apiKey}`;
        const response = await fetch(endpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                system_instruction: { parts: [{ text: systemText }] },
                contents: [{ role: "user", parts: [{ text: userText }] }],
                generationConfig: { temperature: 0.7 }
            })
        });

        if (!response.ok) {
            const errText = await response.text();
            throw new Error(`Google API Error (${response.status}): ${errText}`);
        }

        await parseSSE(response, (data) => {
            if (data.candidates && data.candidates[0]?.content?.parts?.[0]?.text) {
                onChunk(data.candidates[0].content.parts[0].text);
            }
        });
    } else if (activeProvider === 'openrouter' || activeProvider === 'groq') {
        const endpoint = activeProvider === 'openrouter' 
            ? 'https://openrouter.ai/api/v1/chat/completions'
            : 'https://api.groq.com/openai/v1/chat/completions';

        const headers = {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiKey}`
        };

        if (activeProvider === 'openrouter') {
            headers['HTTP-Referer'] = 'https://github.com/promptgod';
            headers['X-Title'] = 'PromptGod Extension';
        }

        const response = await fetch(endpoint, {
            method: 'POST',
            headers: headers,
            body: JSON.stringify({
                model: activeModel,
                messages: [
                    { role: 'system', content: systemText },
                    { role: 'user', content: userText }
                ],
                temperature: 0.7,
                stream: true
            })
        });

        if (!response.ok) {
            const errText = await response.text();
            throw new Error(`${activeProvider.toUpperCase()} API Error (${response.status}): ${errText}`);
        }

        await parseSSE(response, (data) => {
            if (data.choices && data.choices[0]?.delta?.content) {
                onChunk(data.choices[0].delta.content);
            }
        });
    } else {
        throw new Error(`Unsupported AI Provider: ${activeProvider}`);
    }
}

// --- Main Listener ---
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.type === "PROMPTGOD_ANALYZE_SITE") {
    handleSiteAnalysis(request, sender.tab, sendResponse);
    return true;
  }
});

chrome.runtime.onConnect.addListener((port) => {
    if (port.name === 'promptgod-stream') {
        port.onMessage.addListener(async (request) => {
            if (request.type === "PROMPTGOD_ENHANCE_PROMPT_STREAM") {
                await handlePromptEnhancementStream(request, port);
            }
        });
    }
});

async function handleSiteAnalysis(request, tab, sendResponse) {
  try {
    const { provider, apiKey, model, customModel } = await chrome.storage.sync.get(['provider', 'apiKey', 'model', 'customModel']);
    if (!apiKey) {
      chrome.runtime.openOptionsPage();
      return sendResponse({ error: "API Key not set. Please configure it in options." });
    }
    
    const targetUrl = request.url || tab?.url || 'https://general.com';
    const domain = cleanDomain(targetUrl);

    // 1. Try reading from Firestore REST API directly
    const firestoreData = await getFirestoreDoc('sites', domain);
    if (firestoreData && Array.isArray(firestoreData.functions)) {
        return sendResponse({ success: true, data: firestoreData });
    }

    // 2. Try reading from local chrome storage cache as fallback
    const localCacheKey = `site_${domain}`;
    const localCache = await chrome.storage.local.get([localCacheKey]);
    if (localCache[localCacheKey]) {
        return sendResponse({ success: true, data: localCache[localCacheKey] });
    }

    // 3. Generate site functions via AI Provider
    const prompt = `Based on your knowledge, what are the primary generative AI functions offered by the website at the URL "${targetUrl}"?
Respond ONLY with a valid JSON object with a single key "functions" which is an array of strings. Do not include any other text or markdown.
Example: {"functions": ["Text Generation", "Code Generation", "Image Generation"]}`;

    let siteData;
    const resolvedModel = model === 'custom' ? customModel : model;
    
    try {
        const textResponse = await callAIProvider(prompt, provider, resolvedModel, apiKey);
        siteData = extractJsonFromText(textResponse);
    } catch (e) {
        console.warn("AI analysis warning, using fallback functions:", e);
    }
    
    if (!siteData || !siteData.functions || !Array.isArray(siteData.functions) || siteData.functions.length === 0) {
        siteData = { functions: ["Text Generation", "General AI Assistant", "Code Generation"] };
    }
    
    siteData.domain = domain;
    
    // Save to Firestore REST API & Local Storage
    await setFirestoreDoc('sites', domain, siteData);
    await chrome.storage.local.set({ [localCacheKey]: siteData });
    
    sendResponse({ success: true, data: siteData });

  } catch (error) {
    console.error('PromptGod Error:', error);
    sendResponse({ error: error.message || "Failed to analyze site" });
  }
}

async function handlePromptEnhancementStream(request, port) {
  try {
    const { provider, apiKey, model, customModel } = await chrome.storage.sync.get(['provider', 'apiKey', 'model', 'customModel']);
    if (!apiKey) {
      return port.postMessage({ type: "STREAM_ERROR", error: "API Key not set in extension options." });
    }
    
    const targetUrl = request.url || 'https://general.com';
    const domain = cleanDomain(targetUrl);
    const selectedFunction = request.selectedFunction;
    const userPrompt = request.prompt;
    
    if (!selectedFunction) {
        return port.postMessage({ type: "STREAM_ERROR", error: "Missing selected function." });
    }
    
    const effectiveUserPrompt = userPrompt || '';

    const enhancementId = `${domain}_${selectedFunction.replace(/\s+/g, '_')}`;
    const resolvedModel = model === 'custom' ? customModel : model;
    
    // 1. Try reading system prompt from Firestore REST API
    let systemPrompt = '';
    const firestoreData = await getFirestoreDoc('enhancements', enhancementId);
    
    if (firestoreData && firestoreData.system_prompt) {
        systemPrompt = firestoreData.system_prompt;
    } else {
        // Try reading from local storage
        const localCacheKey = `prompt_${enhancementId}`;
        const localCache = await chrome.storage.local.get([localCacheKey]);
        
        if (localCache[localCacheKey]) {
            systemPrompt = localCache[localCacheKey];
        } else {
            // Generate Agent 2 System Prompt
            const agent2Prompt = `You are an AI assistant that creates expert-level, token-efficient system prompts for other AI models.
Your task is to generate a concise and robust system prompt for an AI (Agent 3) that will enhance a user's input for the '${selectedFunction}' feature on '${domain}'.

You must respond ONLY with a valid JSON object containing a single key "system_prompt" with the string value of the system prompt. No markdown, no introductory text.

Example:
{"system_prompt": "You are an expert Midjourney prompt engineer. Your goal is to expand a user's simple idea into a rich, detailed, and stylistically-aware prompt. 1. Identify the core subject. 2. Add descriptive details. 3. Incorporate a specific art style. You must only output the final, enhanced prompt and nothing else."}

Generate the JSON object for the '${selectedFunction}' feature on '${domain}'.`;

            try {
                const aiResponseText = await callAIProvider(agent2Prompt, provider, resolvedModel, apiKey);
                const parsed = extractJsonFromText(aiResponseText);
                if (parsed && parsed.system_prompt) {
                    systemPrompt = parsed.system_prompt.trim();
                } else if (parsed && parsed.functions) {
                    // Fallback if it weirdly used the other JSON structure
                    systemPrompt = JSON.stringify(parsed);
                } else {
                    // Manual extraction if JSON parsing completely failed
                    const match = aiResponseText.match(/"system_prompt"\s*:\s*"([^"]+)"/i);
                    systemPrompt = match ? match[1] : aiResponseText.trim();
                }
                
                // Save to Firestore REST API & Local Storage
                const enhancementDoc = { domain, function: selectedFunction, system_prompt: systemPrompt };
                await setFirestoreDoc('enhancements', enhancementId, enhancementDoc);
                await chrome.storage.local.set({ [localCacheKey]: systemPrompt });
            } catch (e) {
                systemPrompt = `You are an expert prompt enhancer for ${selectedFunction} on ${domain}. Expand the user's prompt into a high quality, detailed, professional prompt.`;
            }
        }
    }
    
    // Agent 3: Final Enhancement
    const userInstruction = `USER'S DRAFT PROMPT TO ENHANCE:\n${effectiveUserPrompt}\n\nCRITICAL INSTRUCTION: Respond ONLY with the final, enhanced prompt. Do NOT include any introductory text, markdown formatting, internal thoughts, chain-of-thought reasoning, or meta-commentary. Output the raw prompt text only.`;
    
    await callAIProviderStream(systemPrompt, userInstruction, provider, resolvedModel, apiKey, (chunk) => {
        port.postMessage({ type: "STREAM_CHUNK", chunk: chunk });
    });
    
    port.postMessage({ type: "STREAM_DONE" });
    
  } catch (error) {
    console.error('PromptGod Error:', error);
    port.postMessage({ type: "STREAM_ERROR", error: error.message || "Failed to enhance prompt" });
  }
}