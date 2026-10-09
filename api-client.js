// Never expose a hosting provider's HTML error page as a JSON parser exception.
export async function readApiResponse(response) {
  const contentType = response.headers.get('content-type') || '';
  if (!/\bapplication\/(?:[\w.-]+\+)?json\b/i.test(contentType)) {
    if (response.status >= 500) {
      throw new Error(`The whiteboard server is unavailable (HTTP ${response.status}). Check the hosting deployment logs and try again.`);
    }
    throw new Error(`The login API returned a webpage instead of JSON (HTTP ${response.status}). Run npm start and open http://localhost:3000, or deploy this project as a Node Web Service. A static deployment cannot handle sign-in.`);
  }
  let result;
  try { result = await response.json(); }
  catch { throw new Error(`The whiteboard server returned invalid JSON (HTTP ${response.status}). Check the server logs and redeploy the complete project.`); }
  if (!result || typeof result !== 'object' || Array.isArray(result)) {
    throw new Error('The login API returned an unexpected response. Check that this URL serves the whiteboard Node server.');
  }
  if (!response.ok) throw new Error(typeof result.error === 'string' ? result.error : `Sign-in failed (HTTP ${response.status}).`);
  if (result.ok !== true) throw new Error('The server did not confirm sign-in. Check that /api/login reaches the whiteboard Node server.');
  return result;
}
