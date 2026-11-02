# Chrome Web Store listing text — v3.19.1 (local-only)

Title and summary come from the package (`appName` / `appDescription` in
`_locales/en` and `_locales/bg`); you don't type them in the dashboard.
- English: "Fake Discount Bulgaria - Catch Faked Sales"
- Bulgarian: "Fake Discount BG – истински ли са намаленията"

## Store listing → Description

Do not list store names in the description: version 3.19.0 was rejected for
"excessive keywords" (Yellow Argon) because of a list of the supported stores.
Replace the whole description in both languages with the text below.

### English (default language)

Fake Discount BG helps you tell a real discount from a fake one when you shop online in Bulgaria.

When you open a product in one of 20 supported Bulgarian online stores, the extension remembers that day's price and adds a compact panel below the product:
• A clear signal — for example when the claimed "original" price is far above anything seen before, when today's offer is the lowest you have seen, or when it keeps changing.
• Today's price next to the lowest, average and highest seen so far.
• A day-by-day chart with the claimed "was" price and the average.
• An optional target: enter what you want to pay, see it as a line on the chart, and the extension icon shows 🎯 once it is reached.

Its menu lists everything you follow, with search, filters and sorting. In its settings you can turn individual stores on or off, switch between Bulgarian and English, and export or import your history.

Private by design
• Everything stays in your browser. The extension has no server and sends nothing anywhere.
• No account, no ads, no tracking.
• It runs only on the supported stores; the full list is in its settings.

Good to know
• History starts the first time you open a product; signals become more reliable after about a week.
• Signals are a guide, not proof: they rely only on what your browser has recorded.
• Not affiliated with any store.

### Bulgarian (Български)

Fake Discount BG ви помага да различите истинското намаление от фалшивото, когато пазарувате онлайн в България.

Когато отворите продукт в някой от 20-те поддържани български онлайн магазина, разширението запомня цената за деня и добавя компактен панел под продукта:
• Ясен сигнал — например когато обявената „стара“ цена е далеч над всичко видяно досега, когато днешната оферта е най-ниската, която сте виждали, или когато често се променя.
• Днешната цена до най-ниската, средната и най-високата, видяни досега.
• Графика ден по ден с обявената „стара“ цена и средната стойност.
• Цел по желание: въведете колко искате да платите, вижте я като линия в графиката, а иконата на разширението показва 🎯, когато бъде достигната.

В менюто му са всички продукти, които следите, с търсене, филтри и подреждане. В настройките можете да включвате и изключвате отделни магазини, да избирате между български и английски и да експортирате или импортирате историята си.

Поверителност
• Всичко остава в браузъра ви. Разширението няма сървър и не изпраща нищо никъде.
• Без регистрация, без реклами, без проследяване.
• Работи само в поддържаните магазини; пълният списък е в настройките.

Добре е да знаете
• Историята започва от първото отваряне на продукта; сигналите стават по-надеждни след около седмица.
• Сигналите са ориентир, а не доказателство — основават се само на записаното в браузъра ви.
• Разширението не е свързано с нито един магазин.

## Privacy tab

**Single purpose**
Records the prices of products the user views on 20 supported Bulgarian online stores, keeps that price history locally in the browser, and shows a price-history chart with a signal about whether a displayed discount looks genuine.

**Permission justification**
- `storage` — Saves the price history of viewed products, price targets and settings in chrome.storage.local on the user's device. Nothing is sent anywhere.
- `tabs` — Lets the extension notice when a supported store switches product pages without a full reload, so it reads the new product, and sets the per-tab badge on the extension icon. URLs of other sites are ignored and never stored.
- Host permissions — The 20 store domains are needed to read the price, title and image of the product the user is viewing and to show the price panel on that page. No other site is accessed.

(`alarms` and the supabase.co host are no longer requested, so their fields disappear.)

**Remote code:** No, I am not using remote code.

**Data usage** — tick only:
- Web history (addresses, titles and visit dates of supported product pages, stored locally)
- Website content (product titles, prices and image addresses, stored locally)

Leave unticked: personally identifiable information, health, financial and payment, authentication, personal communications, location, user activity.

Tick all three certifications (no selling or transferring data, no use unrelated to the single purpose, no creditworthiness or lending use).

**Privacy policy URL:** https://github.com/victortserovski/Fake-Discount-BG/blob/main/PRIVACY.md
(Push the updated PRIVACY.md to GitHub before submitting — the link shows whatever is on `main`.)
