// Охранные глобалы общих модулей для проекта главного процесса
// (tsconfig.main.json; в tsconfig.renderer.json этот файл не входит — там
// настоящие `window`/`document` из lib dom и types/globals.d.ts).
//
// Зачем. Общие модули (constants, utils, settings-schema…) живут в обоих мирах
// и спрашивают `typeof window !== 'undefined' && window.X`. В проекте главного
// процесса lib dom нет, и каждое такое обращение — TS2304. Здесь `window`
// объявлен как «нет окна ИЛИ объект с ровно теми полями, которые общие модули
// читают и пишут»; типы полей — из экспорта модуля, как в globals.d.ts.
// `document` в главном процессе не бывает вовсе.

declare var window: undefined | {
    CONFIG?: typeof import('../constants.js');
    TimeUtils?: Omit<typeof import('../utils.js'), 'safelySendToWindow'>;
    DisplayLayouts?: typeof import('../display-layouts.js');
    MoneyMeter?: typeof import('../money-meter.js');
    EventReport?: typeof import('../event-report.js');
    SettingsSchema?: typeof import('../settings-schema.js');
    WindowGeometry?: typeof import('../window-geometry.js');
};

declare var document: undefined;

// window-geometry.js описывает перетаскивание через DOM-типы в JSDoc; в проекте
// главного процесса их нет. Объявлено ровно то, что модуль зовёт у цели.
interface Element {
    addEventListener(type: string, listener: (event: never) => void): void;
}
interface Document {
    addEventListener(type: string, listener: (event: never) => void): void;
}
