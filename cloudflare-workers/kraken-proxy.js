/**
 * Cloudflare Worker - Kraken API Proxy
 *
 * This worker acts as a proxy to bypass DNS/network blocking for Kraken API.
 * Deploy this to Cloudflare Workers and use your worker URL in the bot.
 *
 * HOW TO DEPLOY:
 * 1. Go to https://dash.cloudflare.com/
 * 2. Click "Workers & Pages"
 * 3. Click "Create Application" → "Create Worker"
 * 4. Name it: "kraken-proxy" (or anything you want)
 * 5. Copy and paste this entire code
 * 6. Click "Save and Deploy"
 * 7. Copy your worker URL (e.g., https://kraken-proxy.YOUR-SUBDOMAIN.workers.dev)
 * 8. Use that URL in your bot's .env file
 */

addEventListener('fetch', event => {
  event.respondWith(handleRequest(event.request))
})

async function handleRequest(request) {
  // Enable CORS for your bot to access this worker
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  }

  // Handle CORS preflight
  if (request.method === 'OPTIONS') {
    return new Response(null, {
      headers: corsHeaders
    })
  }

  try {
    // Extract the path from the request URL
    const url = new URL(request.url)
    const path = url.pathname
    const queryString = url.search

    // Build the Kraken API URL
    const krakenUrl = `https://api.kraken.com${path}${queryString}`

    // Forward the request to Kraken API
    const krakenRequest = new Request(krakenUrl, {
      method: request.method,
      headers: request.headers,
      body: request.method !== 'GET' ? await request.text() : undefined
    })

    // Get response from Kraken
    const krakenResponse = await fetch(krakenRequest)

    // Clone the response and add CORS headers
    const response = new Response(krakenResponse.body, {
      status: krakenResponse.status,
      statusText: krakenResponse.statusText,
      headers: {
        ...Object.fromEntries(krakenResponse.headers),
        ...corsHeaders
      }
    })

    return response

  } catch (error) {
    return new Response(JSON.stringify({
      error: 'Proxy error',
      message: error.message
    }), {
      status: 500,
      headers: {
        'Content-Type': 'application/json',
        ...corsHeaders
      }
    })
  }
}
