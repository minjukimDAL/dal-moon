const https = require('https');

// Gemini 호출
function callGemini(body, apiKey) {
  const model = body.model || 'gemini-2.5-flash';
  const payload = JSON.stringify({
    contents: body.contents,
    generationConfig: body.generationConfig || { maxOutputTokens: 8000, temperature: 0.7 }
  });
  return new Promise((resolve, reject) => {
    const urlPath = `/v1/models/${model}:generateContent?key=${apiKey}`;
    const options = {
      hostname: 'generativelanguage.googleapis.com',
      path: urlPath,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload)
      }
    };
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve({ status: res.statusCode, body: data }));
    });
    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

// GPT 폴백 호출 (Gemini contents → OpenAI messages 변환)
function callGPT(body, apiKey) {
  // Gemini contents 형식 → OpenAI messages 형식으로 변환
  const messages = (body.contents || []).map(c => ({
    role: c.role === 'user' ? 'user' : 'assistant',
    content: (c.parts || []).map(p => p.text || '').join('')
  }));

  const payload = JSON.stringify({
    model: 'gpt-4o-mini',
    messages: messages,
    max_tokens: (body.generationConfig && body.generationConfig.maxOutputTokens) || 8000,
    temperature: (body.generationConfig && body.generationConfig.temperature) || 0.7
  });

  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'api.openai.com',
      path: '/v1/chat/completions',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
        'Content-Length': Buffer.byteLength(payload)
      }
    };
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve({ status: res.statusCode, body: data }));
    });
    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

// GPT 응답 → Gemini 응답 형식으로 변환 (index.html이 그대로 파싱 가능)
function convertGPTToGeminiFormat(gptBody) {
  try {
    const gpt = JSON.parse(gptBody);
    const text = gpt.choices && gpt.choices[0] && gpt.choices[0].message
      ? gpt.choices[0].message.content : '';
    return JSON.stringify({
      candidates: [{
        content: { parts: [{ text }], role: 'model' },
        finishReason: 'STOP'
      }]
    });
  } catch(e) {
    return gptBody;
  }
}

exports.handler = async function(event) {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Content-Type': 'application/json'
  };
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };
  }
  try {
    const body = JSON.parse(event.body);
    const geminiKey = process.env.GEMINI_API_KEY;
    const openaiKey = process.env.openai_api_key;

    if (!geminiKey) {
      return { statusCode: 500, headers, body: JSON.stringify({ error: 'GEMINI_API_KEY not set' }) };
    }

    // 1차: Gemini 시도
    const geminiResult = await callGemini(body, geminiKey);

    // Gemini 성공 시 바로 반환
    if (geminiResult.status === 200) {
      return { statusCode: 200, headers, body: geminiResult.body };
    }

    // Gemini 503(혼잡) 또는 429(한도초과) → GPT 폴백 시도
    if ((geminiResult.status === 503 || geminiResult.status === 429) && openaiKey) {
      console.log(`[Fallback] Gemini ${geminiResult.status} → GPT 폴백 시도`);
      const gptResult = await callGPT(body, openaiKey);
      if (gptResult.status === 200) {
        // GPT 응답을 Gemini 형식으로 변환해서 반환
        const converted = convertGPTToGeminiFormat(gptResult.body);
        return { statusCode: 200, headers, body: converted };
      }
    }

    // 둘 다 실패
    return { statusCode: geminiResult.status, headers, body: geminiResult.body };

  } catch (error) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: error.message }) };
  }
};
