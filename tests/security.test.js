const test = require('node:test');
const assert = require('node:assert/strict');
const {
    isValidDataURL,
    validateImageSource,
    safeJSONParse,
    isSafeColor,
    escapeHTML
} = require('../security');

// isValidDataURL
test('isValidDataURL accepts valid base64 image data URLs', () => {
    assert.equal(isValidDataURL('data:image/png;base64,iVBOR'), true);
    assert.equal(isValidDataURL('data:image/jpeg;base64,/9j/4A=='), true);
    assert.equal(isValidDataURL('data:image/gif;base64,R0lGOD'), true);
    assert.equal(isValidDataURL('data:image/webp;base64,UklGR'), true);
    assert.equal(isValidDataURL('data:image/bmp;base64,Qk0='), true);
});

test('isValidDataURL rejects SVG (XSS vector)', () => {
    assert.equal(isValidDataURL('data:image/svg+xml;base64,PHN2Zz4='), false);
});

test('isValidDataURL rejects invalid inputs', () => {
    assert.equal(isValidDataURL(null), false);
    assert.equal(isValidDataURL(''), false);
    assert.equal(isValidDataURL(123), false);
    assert.equal(isValidDataURL('data:text/html;base64,abc'), false);
    assert.equal(isValidDataURL('data:image/png;base64,<script>'), false);
    assert.equal(isValidDataURL('not-a-data-url'), false);
    assert.equal(isValidDataURL('javascript:alert(1)'), false);
});

// validateImageSource — data: URLs only (HTTP(S) loading removed)
test('validateImageSource validates data URLs', () => {
    const valid = validateImageSource('data:image/png;base64,iVBOR');
    assert.equal(valid.valid, true);
    assert.equal(valid.error, null);

    const invalid = validateImageSource('data:image/svg+xml;base64,abc');
    assert.equal(invalid.valid, false);
});

test('validateImageSource rejects remote URLs', () => {
    assert.equal(validateImageSource('https://example.com/img.jpg').valid, false);
    assert.equal(validateImageSource('http://example.com/img.png').valid, false);
});

test('validateImageSource rejects invalid sources', () => {
    assert.equal(validateImageSource(null).valid, false);
    assert.equal(validateImageSource('').valid, false);
    assert.equal(validateImageSource('javascript:alert(1)').valid, false);
    assert.equal(validateImageSource('file:///etc/passwd').valid, false);
});

// safeJSONParse
test('safeJSONParse handles valid JSON', () => {
    assert.deepEqual(safeJSONParse('{"a":1}'), { a: 1 });
    assert.deepEqual(safeJSONParse('[1,2,3]'), [1, 2, 3]);
    assert.equal(safeJSONParse('"hello"'), 'hello');
});

test('safeJSONParse returns default on invalid input', () => {
    assert.equal(safeJSONParse(null, 'default'), 'default');
    assert.deepEqual(safeJSONParse('', []), []);
    assert.equal(safeJSONParse('not json', 42), 42);
    assert.equal(safeJSONParse(undefined), null);
});

// isSafeColor
test('isSafeColor accepts valid hex and rgba colors', () => {
    assert.ok(isSafeColor('#fff'));
    assert.ok(isSafeColor('#FF0000'));
    assert.ok(isSafeColor('#ff000080'));
    assert.ok(isSafeColor('rgb(255, 128, 0)'));
    assert.ok(isSafeColor('rgba(0, 0, 0, 0.5)'));
    assert.ok(isSafeColor('rgba(255, 255, 255, 1)'));
});

test('isSafeColor rejects invalid and dangerous values', () => {
    assert.ok(!isSafeColor(null));
    assert.ok(!isSafeColor(''));
    assert.ok(!isSafeColor('red'));
    assert.ok(!isSafeColor('rgb(999, 0, 0)'));
    assert.ok(!isSafeColor('rgba(0, 0, 0, 2)'));
    assert.ok(!isSafeColor('url(javascript:alert(1))'));
    assert.ok(!isSafeColor('#xyz'));
    assert.ok(!isSafeColor('expression(alert(1))'));
});

// escapeHTML
test('escapeHTML escapes all dangerous characters', () => {
    assert.equal(escapeHTML('<script>alert("xss")</script>'),
        '&lt;script&gt;alert(&quot;xss&quot;)&lt;&#x2F;script&gt;');
    assert.equal(escapeHTML("it's & <b>bold</b>"),
        "it&#39;s &amp; &lt;b&gt;bold&lt;&#x2F;b&gt;");
    assert.equal(escapeHTML(''), '');
    assert.equal(escapeHTML(null), '');
    assert.equal(escapeHTML(123), '');
});
