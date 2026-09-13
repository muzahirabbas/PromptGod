import os
import re
import json
import logging
import traceback
from flask import Flask, request, jsonify
from flask_cors import CORS
import google.generativeai as genai
from google.cloud import firestore
from google.oauth2 import service_account

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s [%(levelname)s] %(message)s',
    datefmt='%Y-%m-%d %H:%M:%S'
)
logger = logging.getLogger(__name__)

app = Flask(__name__)
# For production, restrict this to your extension's ID
CORS(app) 

try:
    credentials = service_account.Credentials.from_service_account_file('key.json')
    db = firestore.Client(credentials=credentials)
    logger.info("✅ Firestore client initialized successfully!")
except Exception as e:
    logger.error(f"❌ FATAL ERROR: Could not initialize Firestore client: {e}")
    logger.error(traceback.format_exc())
    db = None

def clean_domain(url):
    """Extracts a clean domain name from a URL."""
    try:
        domain = re.sub(r'^https?:\/\/', '', url)
        domain = domain.split('/')[0]
        domain = domain.replace('www.', '')
        return domain
    except Exception as e:
        logger.warning(f"Failed to clean domain for {url}: {e}")
        return url

def extract_json_from_text(text):
    """Robustly extracts a JSON object from text that might contain markdown or filler."""
    # Try to find a JSON block in markdown
    match = re.search(r'```(?:json)?\s*(\{.*?\})\s*```', text, re.DOTALL | re.IGNORECASE)
    if match:
        return json.loads(match.group(1))
    
    # Try to find the outermost curly braces
    match = re.search(r'\{.*\}', text, re.DOTALL)
    if match:
        return json.loads(match.group(0))
    
    # Fallback to just parsing the raw text
    return json.loads(text)

@app.route('/analyze-site', methods=['POST'])
def analyze_site():
    if not db:
        return jsonify({"error": "Firestore not configured"}), 500
    try:
        data = request.get_json()
        url = data.get('url')
        api_key = data.get('apiKey')
        model_name = data.get('model', 'gemma-2-9b-it')

        if not all([url, api_key]):
            logger.warning("Analyze Site: Missing url or apiKey")
            return jsonify({"error": "Missing url or apiKey"}), 400

        genai.configure(api_key=api_key)
        model = genai.GenerativeModel(model_name)
        
        domain = clean_domain(url)
        logger.info(f"Analyzing site: {domain} using model: {model_name}")
        
        site_ref = db.collection('sites').document(domain)
        site_doc = site_ref.get()

        if site_doc.exists:
            logger.info(f"Cache hit for domain: {domain}")
            return jsonify(site_doc.to_dict()), 200

        prompt = f"""
        Based on your knowledge, what are the primary generative AI functions offered by the website at the URL "{url}"?
        Respond ONLY with a valid JSON object with a single key "functions" which is an array of strings. Do not include any other text or markdown.
        Example: {{"functions": ["Text Generation", "Code Generation", "Image Generation"]}}
        """
        response = model.generate_content(prompt)
        
        try:
            site_data = extract_json_from_text(response.text)
        except json.JSONDecodeError as e:
            logger.error(f"Failed to parse JSON from response: {response.text}")
            raise ValueError(f"AI response was not valid JSON: {e}")
        
        if "functions" not in site_data or not isinstance(site_data["functions"], list):
            raise ValueError("AI response did not contain a valid 'functions' array.")

        site_data['domain'] = domain
        site_ref.set(site_data)
        logger.info(f"Successfully analyzed and cached domain: {domain}")
        return jsonify(site_data), 200
        
    except Exception as e:
        logger.error(f"AI analysis failed for {url}: {str(e)}")
        logger.error(traceback.format_exc())
        return jsonify({"error": f"AI analysis failed: {str(e)}"}), 500

@app.route('/enhance-prompt', methods=['POST'])
def enhance_prompt():
    if not db:
        return jsonify({"error": "Firestore not configured"}), 500
    try:
        data = request.get_json()
        url = data.get('url')
        selected_function = data.get('function')
        user_prompt = data.get('prompt')
        api_key = data.get('apiKey')
        model_name = data.get('model', 'gemma-2-9b-it')

        if not all([url, selected_function, user_prompt, api_key]):
            logger.warning("Enhance Prompt: Missing required parameters")
            return jsonify({"error": "Missing required parameters"}), 400
        
        genai.configure(api_key=api_key)
        domain = clean_domain(url)
        logger.info(f"Enhancing prompt for {domain} - {selected_function} using model: {model_name}")
        
        enhancement_id = f"{domain}_{selected_function.replace(' ', '_')}"
        enhancement_ref = db.collection('enhancements').document(enhancement_id)
        enhancement_doc = enhancement_ref.get()

        system_prompt_for_agent3 = ""
        if enhancement_doc.exists:
            logger.info(f"Cache hit for enhancement prompt: {enhancement_id}")
            system_prompt_for_agent3 = enhancement_doc.to_dict().get('system_prompt', '')
        else:
            logger.info(f"Generating new system prompt for: {enhancement_id}")
            agent2_model = genai.GenerativeModel(model_name)
            
            prompt_agent2 = f"""
            You are an AI assistant that creates expert-level, token-efficient system prompts for other AI models.
            Your task is to generate a concise and robust system prompt for an AI (Agent 3) that will enhance a user's input for the '{selected_function}' feature on '{domain}'.

            Follow the example below to structure your output. Be direct and avoid conversational fluff.

            --- EXAMPLE ---
            **Request:** Create a system prompt for the 'Image Generation' feature on 'midjourney.com'.
            **Your Output (Example System Prompt):**
            You are an expert Midjourney prompt engineer. Your goal is to expand a user's simple idea into a rich, detailed, and stylistically-aware prompt.
            1.  Identify the core subject.
            2.  Add descriptive details about the subject, environment, and mood.
            3.  Incorporate a specific art style, medium, or artist (e.g., 'impressionistic oil painting', 'shot on 35mm film', 'in the style of Hayao Miyazaki').
            4.  Append relevant technical parameters like aspect ratio (`--ar 16:9`) or stylization (`--s 750`).
            5.  Synthesize these elements into a single, comma-separated paragraph.
            You must only output the final, enhanced prompt and nothing else.
            --- END EXAMPLE ---

            Now, generate the system prompt for the '{selected_function}' feature on '{domain}'. Respond ONLY with the complete system prompt for Agent 3.
            """
            
            response_agent2 = agent2_model.generate_content(prompt_agent2)
            system_prompt_for_agent3 = response_agent2.text.strip()

            enhancement_data = {
                'domain': domain,
                'function': selected_function,
                'system_prompt': system_prompt_for_agent3
            }
            enhancement_ref.set(enhancement_data)

        # Agent 3: Use the generated or cached system prompt to enhance the user's prompt
        # We manually combine the system prompt and user prompt to ensure 100% compatibility with Gemma models
        # which might not natively support the system_instruction parameter in the same way Gemini does.
        agent3_model = genai.GenerativeModel(model_name=model_name)
        
        combined_prompt = f"""
        {system_prompt_for_agent3}
        
        ---
        USER'S DRAFT PROMPT TO ENHANCE:
        {user_prompt}
        
        Respond ONLY with the final, enhanced prompt. Do not include introductory text.
        """
        
        response_agent3 = agent3_model.generate_content(combined_prompt.strip())
        enhanced_prompt = response_agent3.text.strip()
        
        logger.info("Successfully enhanced prompt")
        return jsonify({"enhanced_prompt": enhanced_prompt}), 200

    except Exception as e:
        logger.error(f"An unexpected error occurred in enhancement: {str(e)}")
        logger.error(traceback.format_exc())
        return jsonify({"error": f"An unexpected error occurred in enhancement: {str(e)}"}), 500

if __name__ == '__main__':
    app.run(debug=True, port=5000)