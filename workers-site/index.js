import { getAssetFromKV, mapRequestToAsset } from '@cloudflare/kv-asset-handler'

/**
 * The DEBUG flag will do two things that help during development:
 * 1. we will skip caching on the edge, which makes it easier to
 *    debug.
 * 2. we will return an error message on exception in your Response rather
 *    than the default 404.html page.
 */
const DEBUG = false

addEventListener('fetch', event => {
  try {
    event.respondWith(handleEvent(event))
  } catch (e) {
    if (DEBUG) {
      return event.respondWith(
        new Response(e.message || e.toString(), {
          status: 500,
        }),
      )
    }
    event.respondWith(new Response('Internal Error', { status: 500 }))
  }
})

function setCachePolicy(headers, extension) {
  // Cached for 1 year (these are fingerprinted)
  const longTermCache = ['.css', '.ttf', '.woff', '.woff2', '.js', '.png', '.jpg', '.jpeg', '.webp', '.svg']
  // Cached for 1 week (these are NOT fingerprinted)
  const shortTermCache = ['.ico', '.json']
  if (longTermCache.includes(extension)) {
    headers.set("Cache-Control", "max-age=31536000, public")
  } else if (shortTermCache.includes(extension)) {
    headers.set("Cache-Control", "max-age=604800, public")
  }
}

function getProperties(url_string) {
  const endsWithSlash = url_string.endsWith('/')
  // If the page ends with a slash, it's not a file
  var isFile = false;
  var missingSlash = false
  var fileExtension = ""
  var atRoot = false

  if (!endsWithSlash) {
    const nameStartIndex = url_string.lastIndexOf('/')

    atRoot = nameStartIndex == -1
    if (!atRoot) {
      // We get the filename
      const filename = url_string.substr(nameStartIndex)
      // We look for the extension in the filename
      const extStartIndex = filename.lastIndexOf('.')

      if (extStartIndex == -1) {
        // If...
        // - There's no slash at the end of the path
        // - We're not at the root of the site
        // - The filename is missing an extension
        // Then it's not actually a filename.
        // Instead, we're missing a slash.

        missingSlash = true
      } else {
        fileExtension = filename.substr(extStartIndex)
        isFile = true
      }
    }
  }
  return {
    isFile,
    fileExtension,
    missingSlash,
    atRoot
  }
}

async function handleEvent(event) {
  const url_string = event.request.url
  const properties = getProperties(url_string)

  // If the url is missing a slash, then we return a redirect
  if (properties.missingSlash) {
    return Response.redirect(new URL(url_string + '/'), 301)
  }


  let options = {}

  /**
   * You can add custom logic to how we fetch your assets
   * by configuring the function `mapRequestToAsset`
   */
  // options.mapRequestToAsset = handlePrefix(/^\/docs/)

  try {
    if (DEBUG) {
      // customize caching
      options.cacheControl = {
        bypassCache: true,
      };
    }
    const page = await getAssetFromKV(event, options);

    // allow headers to be altered
    const response = new Response(page.body, page);

    response.headers.set("X-XSS-Protection", "1; mode=block");
    response.headers.set("X-Content-Type-Options", "nosniff");
    response.headers.set("X-Frame-Options", "DENY");
    response.headers.set("Referrer-Policy", "unsafe-url");
    response.headers.set("Feature-Policy", "none");

    if (properties.isFile) {
      setCachePolicy(response.headers, properties.fileExtension);
    }

    return response;

  } catch (e) {
    // if an error is thrown try to serve the asset at 404.html
    if (!DEBUG) {
      try {
        let notFoundResponse = await getAssetFromKV(event, {
          mapRequestToAsset: req => new Request(`${new URL(req.url).origin}/404.html`, req),
        })

        return new Response(notFoundResponse.body, { ...notFoundResponse, status: 404 })
      } catch (e) {}
    }

    return new Response(e.message || e.toString(), { status: 500 })
  }
}

/**
 * Here's one example of how to modify a request to
 * remove a specific prefix, in this case `/docs` from
 * the url. This can be useful if you are deploying to a
 * route on a zone, or if you only want your static content
 * to exist at a specific path.
 */
function handlePrefix(prefix) {
  return request => {
    // compute the default (e.g. / -> index.html)
    let defaultAssetKey = mapRequestToAsset(request)
    let url = new URL(defaultAssetKey.url)

    // strip the prefix from the path for lookup
    url.pathname = url.pathname.replace(prefix, '/')

    // inherit all other props from the default request
    return new Request(url.toString(), defaultAssetKey)
  }
}