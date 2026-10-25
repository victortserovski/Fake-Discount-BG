# Chrome Web Store listing text — v3.19.0 (local-only)

Summary (short description) comes from the package: `_locales/en` and
`_locales/bg` `appDescription`. You don't type it in the dashboard.

## Store listing → Description — English (default language)

Fake Discount BG shows you whether a "discount" in a Bulgarian online store is real.

When you open a product page in one of 20 supported stores, the extension records that day's price and shows a compact panel right on the page:
• a signal about the current price — for example when the claimed "original" price is far above anything seen before, when the price is at its lowest, or when it changes often
• today's price next to the lowest, average and highest price seen
• a day-by-day price chart with the claimed "was" price and the average
• an optional price target — the chart shows a target line and the extension icon shows 🎯 when the price reaches it

The menu lists every product you follow, with search, store filters and sorting. There you can turn individual stores on or off, switch between Bulgarian and English, and export or import your history.

Private by design
• Your price history is stored only in your browser. The extension has no server and sends no data anywhere.
• No account, no ads, no tracking.
• It runs only on the 20 supported stores.

Supported stores: eMAG, Ozone, Notino, Technopolis, Technomarket, Zora, Ardes, Plesio, About You, Answear, Decathlon, dm, Fashion Days, Lilly, Mr. Bricolage, Obuvki, Praktiker, SOpharmacy, Sport Depot, eBag.

Good to know
• History builds up from the first time you open a product; signals become more reliable after about a week of observations.
• Signals are a guide, not proof: they are based only on the prices recorded in your browser.
• Not affiliated with any of the stores.

## Store listing → Description — Bulgarian (Български)

Fake Discount BG ви показва дали „намалението“ в български онлайн магазин е истинско.

Когато отворите продукт в някой от 20-те поддържани магазина, разширението записва цената за деня и показва компактен панел направо на страницата:
• сигнал за текущата цена — например когато обявената „стара“ цена е далеч над всичко видяно досега, когато цената е на най-ниското си ниво или когато се мени често
• днешната цена до най-ниската, средната и най-високата видяна цена
• графика на цената ден по ден с обявената „стара“ цена и средната стойност
• целева цена по желание — графиката показва линия на целта, а иконата на разширението показва 🎯, когато цената я достигне

В менюто са всички продукти, които следите, с търсене, филтри по магазин и подреждане. Там можете да включвате и изключвате отделни магазини, да смените езика (български/английски) и да експортирате или импортирате историята си.

Поверителност
• Историята на цените се пази само в браузъра ви. Разширението няма сървър и не изпраща данни никъде.
• Без регистрация, без реклами, без проследяване.
• Работи само в 20-те поддържани магазина.

Поддържани магазини: eMAG, Ozone, Notino, Технополис, Техномаркет, Зора, Ардес, Plesio, About You, Answear, Decathlon, dm, Fashion Days, Лили, Мосю Бриколаж, Obuvki, Практикер, SOpharmacy, Sport Depot, eBag.

Добре е да знаете
• Историята започва от първото отваряне на продукта; сигналите стават по-надеждни след около седмица наблюдения.
• Сигналите са ориентир, а не доказателство — те се основават само на цените, записани в браузъра ви.
• Разширението не е свързано с нито един от магазините.

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
