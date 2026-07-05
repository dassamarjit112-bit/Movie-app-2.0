export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  const { title, body, image, url } = req.body;
  
  if (!title || !body) {
    return res.status(400).json({ error: 'Missing title or body' });
  }

  const APP_ID = "f7ade4f1-a755-4469-a204-46f57f451a7e";
  const REST_API_KEY = process.env.ONESIGNAL_REST_API_KEY;

  if (!REST_API_KEY) {
    return res.status(500).json({ error: 'Server misconfiguration: missing API key' });
  }

  const payload = {
    app_id: APP_ID,
    included_segments: ["Subscribed Users"],
    headings: { "en": title },
    contents: { "en": body }
  };
  
  if (image) payload.big_picture = image;
  if (url) payload.url = url;

  try {
    const response = await fetch("https://onesignal.com/api/v1/notifications", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Basic ${REST_API_KEY}`
      },
      body: JSON.stringify(payload)
    });
    
    const data = await response.json();
    return res.status(response.status).json(data);
  } catch(e) {
    return res.status(500).json({ error: e.message });
  }
}
