// Провайдер-адаптеры под два варианта из ТЗ (раздел 1: OpenAI gpt-4o-mini / Google Gemini gemini-2.5-flash).
// Формат запросов сверен с актуальной документацией (август 2026):
// - OpenAI: POST /v1/chat/completions, response_format: {type:"json_object"} — гарантирует валидный JSON.
// - Gemini: POST /v1beta/models/{model}:generateContent, generationConfig.responseMimeType: "application/json".

const OPENAI_URL = 'https://api.openai.com/v1/chat/completions';
const GEMINI_URL_TEMPLATE = 'https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent';

export async function callOpenAI({ system, user }, { apiKey, model }) {
  const resp = await fetch(OPENAI_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: model || 'gpt-4o-mini',
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
      response_format: { type: 'json_object' },
      temperature: 0.4,
    }),
  });

  if (!resp.ok) {
    const errText = await resp.text().catch(() => '');
    throw new Error(`OpenAI API вернул ${resp.status}: ${errText.slice(0, 300)}`);
  }

  const data = await resp.json();
  const content = data.choices?.[0]?.message?.content;
  if (!content) {
    throw new Error('OpenAI API вернул ответ без содержимого (choices[0].message.content пуст)');
  }
  return content;
}

export async function callGemini({ system, user }, { apiKey, model }) {
  const url = GEMINI_URL_TEMPLATE.replace('{model}', model || 'gemini-2.5-flash');

  const resp = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-goog-api-key': apiKey,
    },
    body: JSON.stringify({
      contents: [{ parts: [{ text: `${system}\n\n${user}` }] }],
      generationConfig: {
        responseMimeType: 'application/json',
        temperature: 0.4,
      },
    }),
  });

  if (!resp.ok) {
    const errText = await resp.text().catch(() => '');
    throw new Error(`Gemini API вернул ${resp.status}: ${errText.slice(0, 300)}`);
  }

  const data = await resp.json();
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) {
    throw new Error('Gemini API вернул ответ без содержимого (candidates[0].content.parts[0].text пуст)');
  }
  return text;
}
