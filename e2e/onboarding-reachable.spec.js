const { test, expect } = require('@playwright/test');
const { launchApp } = require('./launch');

/**
 * Достижимость кнопки «Проверить обновления».
 *
 * Главное правило этого проекта: зелёный тест НЕ доказывает, что фича
 * достижима. `#syncClockStyle` целый проход был полностью рабочим и при этом
 * лежал внутри `display:none` — логика чинилась, контрол в интерфейс так и не
 * вернули, и ни один тест этого не видел. Юнит-тесты onboarding.js проверяют
 * ПОВЕДЕНИЕ на поддельном DOM и про настоящую разметку не знают ничего.
 *
 * Почему кнопка не КЛИКАЕТСЯ здесь: обработчик вызывает shell.openExternal,
 * то есть открыл бы настоящий браузер на машине, где идёт прогон. Тест,
 * дёргающий системный браузер на каждом запуске CI, — плохой сосед. Поэтому
 * здесь проверяется ровно то, чего не может проверить юнит: элемент есть в
 * живой разметке, он видим, он не выключен и по нему реально можно попасть.
 * Что произойдёт по клику, закрыто tests/onboarding.test.js (канал уходит без
 * payload) и tests/release-gates.test.js (адрес уходит только в openExternal).
 */

let app;
let control;

test.beforeAll(async () => {
    ({ app, control } = await launchApp());
});

test.afterAll(async () => {
    await app.close();
});

test('кнопка «Проверить обновления» видима в подвале справки', async () => {
    // Справка открывается по кнопке, а не программным показом модалки: иначе
    // тест доказывал бы существование разметки, а не путь пользователя к ней.
    await control.click('#faqBtn, #helpBtn, [data-action="faq"]').catch(async () => {
        // Идентификатор кнопки справки за версии менялся — пробуем по надписи.
        await control.click('text=Справка');
    });
    await control.waitForTimeout(400);

    const button = control.locator('#checkUpdatesBtn');
    await expect(button, 'кнопки нет в разметке').toHaveCount(1);
    await expect(button, 'кнопка есть, но невидима — это и есть «фича, до которой не дойти»').toBeVisible();
    await expect(button).toBeEnabled();

    // Доступное имя: кнопка без него для скринридера — безымянный элемент.
    const name = (await button.textContent() || '').trim();
    expect(name.length, 'у кнопки нет текста').toBeGreaterThan(0);

    // И она обязана иметь ненулевой размер: элемент можно сделать «видимым»
    // и при этом схлопнутым в точку.
    const box = await button.boundingBox();
    expect(box.width, 'кнопка схлопнута по ширине').toBeGreaterThan(20);
    expect(box.height, 'кнопка схлопнута по высоте').toBeGreaterThan(10);
});

test('соседняя кнопка сброса на месте — подвал не разъехался', async () => {
    // Кнопка добавлена рядом с «Сбросить настройки». Проверяем, что она не
    // вытолкнула соседа за пределы видимой области: подвал узкий, а две кнопки
    // в нём раньше не жили.
    const reset = control.locator('#resetSettingsBtn');
    await expect(reset).toBeVisible();

    const a = await control.locator('#checkUpdatesBtn').boundingBox();
    const b = await reset.boundingBox();
    expect(a, 'нет геометрии у кнопки обновлений').toBeTruthy();
    expect(b, 'нет геометрии у кнопки сброса').toBeTruthy();

    // Не перекрывают друг друга.
    const overlap = !(a.x + a.width <= b.x + 1 || b.x + b.width <= a.x + 1);
    expect(overlap, `кнопки наезжают друг на друга: ${JSON.stringify(a)} / ${JSON.stringify(b)}`).toBe(false);
});
