#!/usr/bin/env node

import fs from 'fs';
import { adapterCapabilities, buildPerpLiveExecutionRequest, submitPerpLiveOrder } from './perps_live_execution_adapter.mjs';

function loadJson(path) {
  return JSON.parse(fs.readFileSync(path, 'utf-8'));
}

function assert(cond, msg) {
  if (!cond) {
    throw new Error(msg);
  }
}

const requestFixturePath = process.argv[2] || new URL('./perps_live_execution_adapter_request_fixture.json', import.meta.url).pathname;
const expectedFixturePath = process.argv[3] || new URL('./perps_live_execution_adapter_expected_response_fixture.json', import.meta.url).pathname;

const requestFixture = loadJson(requestFixturePath);
const expected = loadJson(expectedFixturePath);

const caps = adapterCapabilities();
const request = buildPerpLiveExecutionRequest(requestFixture.plan, requestFixture.approvalIntent, requestFixture.context);
const response = submitPerpLiveOrder(request);

assert(caps.implemented === false, 'adapterCapabilities.implemented must be false in scaffold');
assert(caps.live_order_submission_supported === false, 'live_order_submission_supported must be false in scaffold');
assert(request.market.symbol === requestFixture.plan.symbol, 'request symbol mismatch');
assert(request.approval.decision_id === requestFixture.plan.decisionId, 'request decision_id mismatch');
assert(response.implemented === expected.implemented, 'response implemented mismatch');
assert(response.action === expected.action, 'response action mismatch');
assert(response.reason === expected.reason, 'response reason mismatch');
assert(response.adapter_name === expected.adapter_name, 'response adapter_name mismatch');

console.log(JSON.stringify({
  status: 'OK',
  adapter: caps,
  request,
  response,
}, null, 2));
