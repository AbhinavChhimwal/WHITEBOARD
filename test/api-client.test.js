import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readApiResponse } from '../api-client.js';

test('valid login responses and authentication errors', async () => {
  assert.deepEqual(await readApiResponse(Response.json({ok:true})), {ok:true});
  await assert.rejects(readApiResponse(Response.json({error:'Incorrect password.'},{status:401})), /Incorrect password/);
});

test('HTML fallback pages and gateway errors produce actionable messages', async () => {
  await assert.rejects(readApiResponse(new Response('<!DOCTYPE html><html>Static site</html>',{headers:{'content-type':'text/html'}})), /static deployment cannot handle sign-in/);
  await assert.rejects(readApiResponse(new Response('Not Found',{status:404})), /HTTP 404/);
  await assert.rejects(readApiResponse(new Response('<html>Bad gateway</html>',{status:502,headers:{'content-type':'text/html'}})), /server is unavailable \(HTTP 502\)/);
});

test('malformed JSON and incorrect API shapes are handled', async () => {
  await assert.rejects(readApiResponse(new Response('not json',{headers:{'content-type':'application/json'}})), /invalid JSON/);
  await assert.rejects(readApiResponse(Response.json(null)), /unexpected response/);
  await assert.rejects(readApiResponse(Response.json({})), /did not confirm sign-in/);
});
