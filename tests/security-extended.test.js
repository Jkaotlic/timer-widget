const test = require('node:test');
const assert = require('node:assert/strict');
const { safeSetBackgroundImage } = require('../security');

// --- safeSetBackgroundImage tests ---

test('safeSetBackgroundImage returns false for null element', () => {
    assert.equal(safeSetBackgroundImage(null, 'data:image/png;base64,abc='), false);
});

test('safeSetBackgroundImage clears background when imageData is empty', () => {
    const el = { style: { backgroundImage: 'url(old)' } };
    assert.equal(safeSetBackgroundImage(el, ''), true);
    assert.equal(el.style.backgroundImage, '');
});

test('safeSetBackgroundImage clears background when imageData is null', () => {
    const el = { style: { backgroundImage: 'url(old)' } };
    assert.equal(safeSetBackgroundImage(el, null), true);
    assert.equal(el.style.backgroundImage, '');
});

test('safeSetBackgroundImage sets valid data URL', () => {
    const el = { style: { backgroundImage: '' } };
    const dataUrl = 'data:image/png;base64,iVBORw0KGgo=';
    assert.equal(safeSetBackgroundImage(el, dataUrl), true);
    assert.ok(el.style.backgroundImage.includes(dataUrl));
});

test('safeSetBackgroundImage rejects remote URLs', () => {
    const el = { style: { backgroundImage: '' } };
    assert.equal(safeSetBackgroundImage(el, 'https://example.com/img.png'), false);
    assert.equal(el.style.backgroundImage, '');
});

test('safeSetBackgroundImage rejects javascript: URL', () => {
    const el = { style: { backgroundImage: '' } };
    assert.equal(safeSetBackgroundImage(el, 'javascript:alert(1)'), false);
    assert.equal(el.style.backgroundImage, '');
});

test('safeSetBackgroundImage rejects file:// URL', () => {
    const el = { style: { backgroundImage: '' } };
    assert.equal(safeSetBackgroundImage(el, 'file:///etc/passwd'), false);
    assert.equal(el.style.backgroundImage, '');
});

test('safeSetBackgroundImage rejects SVG data URL (XSS vector)', () => {
    const el = { style: { backgroundImage: '' } };
    assert.equal(safeSetBackgroundImage(el, 'data:image/svg+xml;base64,abc='), false);
    assert.equal(el.style.backgroundImage, '');
});

test('safeSetBackgroundImage rejects invalid data URL', () => {
    const el = { style: { backgroundImage: '' } };
    assert.equal(safeSetBackgroundImage(el, 'data:text/html;base64,abc='), false);
});

test('safeSetBackgroundImage handles style setter throwing', () => {
    const el = {
        style: {
            set backgroundImage(_v) { throw new Error('CSS error'); },
            get backgroundImage() { return ''; }
        }
    };
    assert.equal(safeSetBackgroundImage(el, 'data:image/png;base64,iVBORw0KGgo='), false);
});
