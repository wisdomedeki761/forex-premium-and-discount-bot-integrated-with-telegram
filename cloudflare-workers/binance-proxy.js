addEventListener('fetch', event => {
  event.respondWith(handleRequest(event.request))
})

async function handleRequest(request) {
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, X-MBX-APIKEY',
  }

  if (request.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders })
  }

  try {
    const url = new URL(request.url)
    const path = url.pathname
    const queryString = url.search
    const binanceUrl = `https://api.binance.com${path}${queryString}`

    const binanceRequest = new Request(binanceUrl, {
      method: request.method,
      headers: request.headers,
      body: request.method !== 'GET' ? await request.text() : undefined
    })

    const binanceResponse = await fetch(binanceRequest)

    const response = new Response(binanceResponse.body, {
      status: binanceResponse.status,
      statusText: binanceResponse.statusText,
      headers: {
        ...Object.fromEntries(binanceResponse.headers),
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
