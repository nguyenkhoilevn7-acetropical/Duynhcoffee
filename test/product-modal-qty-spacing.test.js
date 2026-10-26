'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

const html = fs.readFileSync(path.join(__dirname, '../index.html'), 'utf8');

test('customer product stepper spaces minus and plus evenly around quantity without affecting cart stepper', () => {
  const doc = new JSDOM(html).window.document;
  const modal = doc.getElementById('product-custom-modal');
  assert.ok(modal);
  const stepper = modal.querySelector('.ios-qty-stepper');
  assert.ok(stepper);
  const controls = [...stepper.children];
  assert.deepEqual(controls.map(element => element.textContent.trim()), ['−', '1', '+']);
  assert.equal(controls[0].getAttribute('onclick'), 'changeCustomModalQty(-1)');
  assert.equal(controls[2].getAttribute('onclick'), 'changeCustomModalQty(1)');
  assert.equal(controls[1].id, 'ios-custom-qty-display');
  const css = [...doc.querySelectorAll('style')].map(el => el.textContent).join('\n');
  assert.match(css, /#product-custom-modal \.ios-qty-stepper\s*\{[^}]*gap:\s*10px\s*;/s);
  assert.match(css, /#product-custom-modal #ios-custom-qty-display\s*\{[^}]*min-width:\s*20px\s*;/s);
  assert.doesNotMatch(css, /#checkout-modal \.ios-qty-stepper\s*\{/);
});
