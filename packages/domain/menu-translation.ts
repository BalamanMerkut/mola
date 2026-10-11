// English labels for menu categories and subcategories on the guest's EN menu.
// Owner-written names win; otherwise a small café / restaurant / bakery dictionary; otherwise the Turkish text.
export type MenuNameEn = { category: string; subtype?: string; name: string };

// Owners often type without Turkish letters ("Tatlilar", "KAHVALTI"); both spellings share one key.
const fold: Record<string, string> = { ç: 'c', ğ: 'g', ı: 'i', ö: 'o', ş: 's', ü: 'u', â: 'a', î: 'i', û: 'u' };
export const menuLabelKey = (label: string) => label.normalize('NFC').trim().replace(/\s+/g, ' ').replace(/[’`´]/g, "'").toLocaleLowerCase('tr').replace(/[çğıöşüâîû]/g, c => fold[c]);

// Turkish spellings separated by "|" → English. Singular/plural variants share an entry where the English reads the same.
const entries: [string, string][] = [
  ['tümü', 'All'], ['tüm türler', 'All types'],
  // Coffee & tea
  ['kahveler|kahve', 'Coffee'], ['sıcak kahveler|sıcak kahve', 'Hot coffees'], ['soğuk kahveler|soğuk kahve|buzlu kahveler|buzlu kahve|ice kahveler', 'Iced coffees'],
  ['espresso bazlı|espresso bazlı kahveler|espresso bazlı içecekler|espresso çeşitleri', 'Espresso-based'], ['espresso|espressolar', 'Espresso'],
  ['filtre kahve|filtre kahveler', 'Filter coffee'], ['türk kahvesi|türk kahveleri|türk kahvesi çeşitleri', 'Turkish coffee'],
  ['demleme kahve|demleme kahveler|demleme yöntemleri|üçüncü dalga kahveler|3. dalga kahveler|nitelikli kahveler', 'Specialty brews'],
  ['sütlü kahveler|sütlü kahve', 'Coffees with milk'], ['sade kahveler|sade kahve', 'Black coffees'], ['aromalı kahveler|aromalı kahve', 'Flavoured coffees'],
  ['çaylar|çay', 'Tea'], ['demleme|demleme çay|demleme çaylar|demlik çay', 'Brewed tea'], ['bitki çayı|bitki çayları|bitki çayları ve infüzyonlar', 'Herbal teas'],
  ['meyve çayı|meyve çayları', 'Fruit teas'], ['özel çaylar|dünya çayları', 'Speciality teas'], ['soğuk çay|soğuk çaylar|ice tea|buzlu çay', 'Iced tea'],
  ['sıcak çikolata', 'Hot chocolate'], ['salep', 'Salep'],
  // Other drinks
  ['içecekler|içecek', 'Drinks'], ['sıcak içecekler|sıcak içecek', 'Hot drinks'], ['soğuk içecekler|soğuk içecek', 'Cold drinks'],
  ['milkshake|milkshakeler|milkshake\'ler', 'Milkshakes'], ['smoothie|smoothieler|smoothie\'ler', 'Smoothies'], ['frozen|frozenlar|frozen\'lar', 'Frozen drinks'], ['frappe|frapeler|frappeler|frappe\'ler', 'Frappés'],
  ['meşrubat|meşrubatlar', 'Soft drinks'], ['gazlı içecek|gazlı içecekler', 'Fizzy drinks'], ['enerji içeceği|enerji içecekleri', 'Energy drinks'],
  ['meyve suyu|meyve suları', 'Fruit juices'], ['taze sıkma|taze sıkma meyve suları|taze meyve suyu|taze meyve suları', 'Freshly squeezed juices'],
  ['limonata|limonatalar', 'Lemonades'], ['ev yapımı limonatalar|ev yapımı limonata', 'Homemade lemonades'],
  ['su ve maden suyu|su & maden suyu|su ve soda|sular', 'Water & mineral water'], ['su', 'Water'], ['maden suyu|maden suları|soda|sodalar', 'Mineral water'],
  ['ayran', 'Ayran'], ['kokteyller|kokteyl', 'Cocktails'], ['alkolsüz kokteyller|alkolsüz kokteyl|mocktail|mocktailler|mocktail\'ler', 'Mocktails'],
  ['şuruplar|şurup', 'Syrups'], ['ekstralar|ekstra|ilaveler|ilave', 'Extras'],
  // Breakfast
  ['kahvaltı|kahvaltılar', 'Breakfast'], ['serpme kahvaltı', 'Turkish breakfast spread'], ['kahvaltılıklar|kahvaltılık', 'Breakfast dishes'],
  ['kahvaltı tabakları|kahvaltı tabağı', 'Breakfast plates'], ['yumurtalar|yumurta|yumurta yemekleri', 'Egg dishes'], ['omletler|omlet', 'Omelettes'],
  ['tostlar|tost', 'Toasties'], ['sandviçler|sandviç|sandviç çeşitleri', 'Sandwiches'], ['waffle|waffleler|waffle\'lar', 'Waffles'], ['krep|krepler', 'Crêpes'], ['pankek|pankekler|pancake|pancakeler', 'Pancakes'],
  ['gözleme|gözlemeler', 'Gözleme'], ['bowl|bowllar|bowl\'lar|kaseler', 'Bowls'],
  // Savoury & mains
  ['atıştırmalıklar|atıştırmalık|aperatifler|aperatif', 'Snacks'], ['başlangıçlar|başlangıç', 'Starters'], ['ara sıcaklar|ara sıcak', 'Hot starters'],
  ['çorbalar|çorba', 'Soups'], ['salatalar|salata', 'Salads'], ['ana yemekler|ana yemek', 'Main courses'], ['ızgaralar|ızgara', 'Grills'],
  ['burgerler|burger|hamburgerler|hamburger', 'Burgers'], ['pizzalar|pizza', 'Pizzas'], ['makarnalar|makarna', 'Pasta'],
  ['dürümler|dürüm', 'Wraps'], ['wrapler|wrap|wrap\'ler', 'Wraps'], ['pideler|pide', 'Pide'], ['lahmacun|lahmacunlar', 'Lahmacun'], ['kebaplar|kebap', 'Kebabs'], ['köfteler|köfte', 'Meatballs'],
  ['mezeler|meze', 'Meze'], ['yan ürünler|yan ürün|yan lezzetler|garnitürler|garnitür', 'Sides'], ['patates|patatesler|kızartmalar', 'Fries'], ['soslar|sos', 'Sauces'],
  ['tavuk yemekleri|tavuklar|tavuk', 'Chicken dishes'], ['et yemekleri|etler', 'Meat dishes'], ['balıklar|balık', 'Fish'], ['deniz ürünleri', 'Seafood'],
  ['ev yemekleri', 'Home-style dishes'], ['günün yemekleri|günün menüsü|günün önerileri', 'Daily specials'], ['şefin önerileri|şefin önerisi|şefin tavsiyesi', 'Chef\'s recommendations'],
  ['dünya mutfağı', 'World cuisine'], ['vejetaryen|vejetaryen yemekler', 'Vegetarian'], ['vegan|vegan ürünler', 'Vegan'], ['glutensiz|glutensiz ürünler', 'Gluten-free'],
  ['çocuk menüsü|çocuk menüleri|çocuklar için', 'Kids\' menu'], ['menüler|menü|kombo menüler|menü seçenekleri|set menüler', 'Set menus'], ['ekmekler|ekmek', 'Bread'],
  ['kampanyalar|kampanyalı ürünler', 'Special offers'], ['yeni ürünler', 'New items'],
  // Desserts & bakery
  ['tatlılar|tatlı', 'Desserts'], ['pastalar|pasta', 'Cakes'], ['dilim pastalar|dilim pasta', 'Cake slices'], ['yaş pastalar|yaş pasta', 'Celebration cakes'], ['kekler|kek', 'Loaf cakes'],
  ['cheesecake|cheesecakeler|cheesecake\'ler', 'Cheesecakes'], ['kurabiyeler|kurabiye', 'Cookies'], ['tartlar|tart|tartolet|tartoletler', 'Tarts'], ['brownie|brownieler', 'Brownies'],
  ['baklavalar|baklava', 'Baklava'], ['şerbetli tatlılar|şerbetli tatlı', 'Desserts in syrup'], ['şerbetli', 'In syrup'], ['sütlü tatlılar|sütlü tatlı', 'Milk desserts'], ['sütlü', 'With milk'],
  ['çikolatalı tatlılar|çikolatalı tatlı', 'Chocolate desserts'], ['çikolatalı', 'Chocolate'], ['meyveli tatlılar|meyveli tatlı', 'Fruit desserts'], ['meyveli', 'Fruity'],
  ['dondurmalar|dondurma', 'Ice cream'], ['sorbe|sorbeler', 'Sorbets'], ['pudingler|puding|muhallebiler|muhallebi', 'Puddings'], ['sütlaç', 'Rice pudding'], ['sufle|sufleler', 'Soufflés'], ['künefe', 'Künefe'],
  ['unlu mamuller|unlu mamul|fırın ürünleri|fırından', 'Bakery'], ['börekler|börek', 'Börek'], ['poğaçalar|poğaça', 'Poğaça'], ['simitler|simit', 'Simit'], ['açmalar|açma', 'Açma'],
  ['kruvasanlar|kruvasan|croissant|croissantlar', 'Croissants'], ['çörekler|çörek', 'Sweet buns'], ['tuzlular|tuzlu ürünler|tuzlu', 'Savoury'], ['lokum|lokumlar', 'Turkish delight'],
  ['çikolatalar', 'Chocolates'], ['kuruyemiş|kuruyemişler', 'Nuts'], ['kiloyla|kilo ile|kiloluk', 'By weight'], ['porsiyon|porsiyonlar|porsiyonluk', 'Single portions'],
];
const dictionary = new Map(entries.flatMap(([tr, en]) => tr.split('|').map(t => [menuLabelKey(t), en] as const)));

/** Dictionary suggestion only (no fallback); the category screen shows it as the placeholder. */
export const menuLabelSuggestion = (label: string) => dictionary.get(menuLabelKey(label));
/** Custom English name, else dictionary, else the Turkish label itself. */
export function menuLabelEn(label: string, custom?: string) { return custom?.trim() || menuLabelSuggestion(label) || label; }
/** English label for a category, or for a subcategory when `subtype` is given. */
export function menuNameEn(names: readonly MenuNameEn[] | undefined, category: string, subtype?: string) {
  const own = names?.find(n => n.category === category && (n.subtype ?? '') === (subtype ?? ''))?.name;
  return menuLabelEn(subtype ?? category, own);
}

// Option groups ("Süt tercihi") and options ("Yulaf sütü") on the EN menu: same rule, separate dictionary,
// because a category "Porsiyon" lists single portions while an option group "Porsiyon" asks for the portion size.
const optionEntries: [string, string][] = [
  // Group names
  ['boy|boyut|boy seçimi|boy tercihi|bardak boyu|bardak boyutu|bardak', 'Size'], ['süt|süt tercihi|süt seçimi|süt çeşidi|süt türü', 'Milk'],
  ['şeker|şeker tercihi|şeker seçimi|şeker durumu|şeker oranı|şeker miktarı', 'Sugar'], ['tatlılık|tatlılık derecesi|tatlılık tercihi', 'Sweetness'],
  ['servis|servis tercihi|servis şekli|sunum|sunum şekli', 'Serving'], ['iç harcı|iç harç|harç|iç|dolgu|iç dolgu', 'Filling'],
  ['acı|acı tercihi|acı derecesi|acı seviyesi|acılık|acılık derecesi|acı oranı', 'Spice level'], ['baharat|baharat tercihi', 'Spices'],
  ['pişme derecesi|pişirme derecesi|pişme|pişirme|pişme tercihi|pişirme tercihi', 'Doneness'], ['pişirme yöntemi|pişirme şekli', 'Cooking method'],
  ['soğan|soğan tercihi', 'Onion'], ['sarımsak|sarımsak tercihi', 'Garlic'], ['sos|sos tercihi|sos seçimi|soslar|sos çeşidi', 'Sauce'],
  ['ekmek|ekmek tercihi|ekmek seçimi|ekmek çeşidi|ekmek türü', 'Bread'], ['porsiyon|porsiyon tercihi|porsiyon seçimi|porsiyon boyu|miktar', 'Portion'],
  ['paketleme|ambalaj|kutu tercihi|paket tercihi', 'Packaging'], ['sıcaklık|sıcaklık tercihi|sıcak / soğuk|sıcak/soğuk|sıcak veya soğuk', 'Temperature'],
  ['ekstra|ekstralar|ilave|ilaveler|ekstra malzeme|ekstra malzemeler|ek malzeme|ek malzemeler|ekler|ilave malzeme|topping|soslar ve ekstralar', 'Extras'],
  ['yanında|yanına|garnitür|garnitür tercihi|yan ürün|yan lezzet', 'On the side'], ['çeşit|çeşidi|tür|türü|lezzet|lezzet tercihi|aroma|aroma tercihi', 'Flavour'],
  ['şurup|şurup tercihi|şurup seçimi', 'Syrup'], ['buz|buz tercihi', 'Ice'], ['shot|shot sayısı|espresso shot', 'Shots'], ['çekirdek|kahve çekirdeği|çekirdek tercihi', 'Coffee beans'],
  ['dem|dem tercihi|dem derecesi', 'Strength'], ['hamur|hamur tercihi|hamur seçimi|hamur çeşidi|hamur türü', 'Crust'], ['peynir|peynir tercihi|peynir seçimi', 'Cheese'],
  ['yumurta|yumurta tercihi|yumurta pişirme', 'Eggs'], ['içecek|içecek seçimi|içecek tercihi', 'Drink'], ['kişi sayısı|kişilik', 'Serves'], ['mum|mum tercihi', 'Candles'],
  ['şerbet|şerbet tercihi|şerbet oranı', 'Syrup'], ['kaymak|kaymak tercihi', 'Clotted cream'], ['dondurma|dondurma tercihi|top dondurma', 'Ice cream'], ['meyve|meyve tercihi', 'Fruit'],
  // Sizes and shots
  ['küçük|küçük boy|small', 'Small'], ['orta boy|medium', 'Medium'], ['büyük|büyük boy|large', 'Large'], ['ekstra büyük|ekstra büyük boy|xl|jumbo', 'Extra large'],
  ['standart|standart boy|normal boy|tek boy', 'Standard'], ['normal', 'Regular'], ['tek|tek shot|single', 'Single'], ['çift|çift shot|duble|double|double shot', 'Double'], ['üçlü|triple', 'Triple'],
  ['fincan', 'Cup'], ['kupa|büyük kupa', 'Mug'], ['çay bardağı|ince belli bardak', 'Tea glass'], ['demlik|demlikte|demlik çay', 'Teapot'],
  // Milk
  ['tam yağlı süt|inek sütü|normal süt|günlük süt', 'Regular milk'], ['laktozsuz|laktozsuz süt', 'Lactose-free milk'], ['yağsız süt|light süt', 'Skimmed milk'], ['yarım yağlı süt', 'Semi-skimmed milk'],
  ['yulaf|yulaf sütü', 'Oat milk'], ['badem sütü', 'Almond milk'], ['soya sütü|soya', 'Soy milk'], ['hindistan cevizi sütü', 'Coconut milk'], ['fındık sütü', 'Hazelnut milk'],
  ['bitkisel süt', 'Plant-based milk'], ['sütsüz', 'No milk'], ['sütlü', 'With milk'], ['bol sütlü|ekstra süt', 'Extra milk'], ['az sütlü', 'A little milk'],
  // Sugar and sweetness
  ['sade', 'Plain'], ['orta', 'Medium'], ['şekersiz', 'No sugar'], ['az şekerli', 'A little sugar'], ['orta şekerli', 'Medium sweet'], ['şekerli', 'With sugar'], ['çok şekerli|bol şekerli', 'Extra sweet'],
  ['tatlandırıcı|tatlandırıcılı', 'Sweetener'], ['esmer şeker|esmer şekerli', 'Brown sugar'], ['ballı', 'With honey'], ['az tatlı', 'Less sweet'],
  ['şerbetli', 'With syrup'], ['az şerbetli', 'Light syrup'], ['bol şerbetli', 'Extra syrup'], ['şerbetsiz', 'No syrup'],
  // Temperature, ice, serving
  ['sıcak', 'Hot'], ['soğuk', 'Cold'], ['ılık', 'Warm'], ['buzlu', 'Iced'], ['buzsuz', 'No ice'], ['az buzlu', 'Light ice'], ['bol buzlu', 'Extra ice'],
  ['paket|paket servis|gel al|götürmek için|al götür|al-götür|paketlensin', 'Takeaway'], ['burada|içeride|masada|restoranda', 'Eat in'], ['ayrı tabakta', 'On a separate plate'],
  ['dondurmalı', 'With ice cream'], ['kaymaklı', 'With clotted cream'], ['krem şantili|şantili', 'With whipped cream'], ['lokumlu', 'With Turkish delight'],
  ['köpüklü', 'Foamy'], ['bol köpüklü', 'Extra foam'], ['köpüksüz', 'No foam'], ['açık', 'Light'], ['koyu|demli|tavşan kanı', 'Strong'], ['limonlu', 'With lemon'],
  // Spice level
  ['acısız', 'Not spicy'], ['az acılı', 'Mildly spicy'], ['orta acılı', 'Medium spicy'], ['acılı', 'Spicy'], ['çok acılı|ekstra acılı|bol acılı', 'Extra spicy'],
  ['baharatsız', 'No spices'], ['baharatlı', 'Spiced'], ['tuzsuz', 'No salt'], ['az tuzlu', 'Less salt'],
  // Doneness and cooking
  ['az pişmiş', 'Rare'], ['orta az pişmiş|orta az', 'Medium rare'], ['orta pişmiş', 'Medium'], ['orta iyi pişmiş|orta iyi', 'Medium well'], ['iyi pişmiş|çok pişmiş|tam pişmiş', 'Well done'],
  ['ızgara', 'Grilled'], ['kızartma|kızarmış', 'Fried'], ['fırında|fırın', 'Baked'], ['buharda', 'Steamed'], ['haşlama|haşlanmış', 'Boiled'],
  ['sahanda|sahanda yumurta', 'Fried eggs'], ['haşlanmış yumurta', 'Boiled egg'], ['rafadan', 'Soft-boiled'], ['kayısı kıvamı', 'Jammy'], ['katı|katı pişmiş', 'Hard-boiled'], ['çırpılmış|scrambled', 'Scrambled'], ['omlet', 'Omelette'],
  // Onion, garlic and "without …"
  ['soğanlı', 'With onion'], ['soğansız', 'No onion'], ['az soğanlı', 'A little onion'], ['karamelize soğan', 'Caramelised onion'], ['sarımsaklı', 'With garlic'], ['sarımsaksız', 'No garlic'],
  ['domatessiz', 'No tomato'], ['turşusuz', 'No pickles'], ['marulsuz', 'No lettuce'], ['mayonezsiz', 'No mayonnaise'], ['ketçapsız', 'No ketchup'], ['hardalsız', 'No mustard'],
  ['soslu', 'With sauce'], ['sossuz', 'No sauce'], ['peynirsiz', 'No cheese'], ['maydanozsuz', 'No parsley'], ['biber|biberli', 'With peppers'], ['bibersiz', 'No peppers'],
  ['glutensiz', 'Gluten-free'], ['vegan', 'Vegan'], ['vejetaryen', 'Vegetarian'], ['yok|istemiyorum|olmasın', 'None'], ['var|olsun', 'Yes'], ['evet', 'Yes'], ['hayır', 'No'],
  // Sauces
  ['ketçap', 'Ketchup'], ['mayonez', 'Mayonnaise'], ['hardal', 'Mustard'], ['ballı hardal', 'Honey mustard'], ['barbekü|barbekü sos|barbekü sosu|bbq', 'Barbecue sauce'],
  ['acı sos', 'Hot sauce'], ['ranch|ranch sos', 'Ranch'], ['sarımsaklı sos|sarımsaklı mayonez', 'Garlic mayo'], ['yoğurt|yoğurtlu', 'Yoghurt'], ['tahin', 'Tahini'], ['nar ekşisi', 'Pomegranate molasses'],
  ['çikolata sos|çikolata sosu|çikolata soslu', 'Chocolate sauce'], ['karamel sos|karamel sosu', 'Caramel sauce'], ['çilek sos|çilek sosu', 'Strawberry sauce'],
  // Bread and dough
  ['beyaz ekmek', 'White bread'], ['tam buğday|tam buğday ekmeği|tam buğday ekmek', 'Wholewheat bread'], ['çavdar|çavdar ekmeği', 'Rye bread'], ['ekşi mayalı|ekşi mayalı ekmek|ekşi maya', 'Sourdough'],
  ['lavaş', 'Lavash'], ['pide ekmek|pide ekmeği', 'Pide bread'], ['bazlama', 'Bazlama'], ['somun|somun ekmek', 'Loaf'], ['brioche|brioş|brioche ekmek', 'Brioche'], ['glutensiz ekmek', 'Gluten-free bread'], ['ekmeksiz', 'No bread'],
  ['ince hamur', 'Thin crust'], ['kalın hamur', 'Thick crust'],
  // Portion
  ['tam porsiyon|tam', 'Full portion'], ['yarım porsiyon|yarım', 'Half portion'], ['bir buçuk porsiyon|1,5 porsiyon|1.5 porsiyon|duble porsiyon', 'Portion and a half'],
  ['çift porsiyon|iki porsiyon', 'Double portion'], ['tek porsiyon', 'Single portion'], ['çocuk porsiyonu|çocuk porsiyon', "Kids' portion"],
  // Packaging and celebrations
  ['hediye kutusu|hediye paketi|hediyelik kutu|hediyelik paket', 'Gift box'], ['kutu|karton kutu|standart kutu', 'Box'], ['metal kutu|teneke kutu', 'Tin box'], ['kurdele|kurdeleli', 'With ribbon'],
  ['mumlu', 'With candles'], ['mumsuz', 'No candles'], ['pasta üstü yazı|yazı', 'Message on the cake'],
  // Extras, sides and flavours
  ['ekstra peynir|ilave peynir', 'Extra cheese'], ['cheddar|cheddar peyniri', 'Cheddar'], ['kaşar|kaşar peyniri', 'Kashar cheese'], ['beyaz peynir', 'White cheese'], ['ekstra köfte|ilave köfte', 'Extra patty'],
  ['ekstra shot|ilave shot|ekstra espresso|ilave espresso', 'Extra shot'], ['krem şanti', 'Whipped cream'], ['kaymak', 'Clotted cream'], ['dondurma|top dondurma|bir top dondurma', 'Ice cream'],
  ['karamel şurubu|karamel', 'Caramel'], ['vanilya şurubu|vanilya', 'Vanilla'], ['fındık şurubu', 'Hazelnut syrup'], ['bal', 'Honey'], ['tereyağı', 'Butter'], ['reçel', 'Jam'],
  ['ekstra yumurta|ilave yumurta', 'Extra egg'], ['sucuk|sucuklu', 'Sucuk'], ['pastırma|pastırmalı', 'Pastırma'], ['avokado', 'Avocado'], ['mantar|mantarlı', 'Mushrooms'], ['zeytin|zeytinli', 'Olives'],
  ['jalapeno|jalapeño', 'Jalapeño'], ['ızgara tavuk', 'Grilled chicken'], ['tavuk|tavuklu', 'Chicken'], ['pirinç pilavı|pilav', 'Rice pilaf'], ['bulgur pilavı', 'Bulgur pilaf'],
  ['patates|patates kızartması', 'Fries'], ['salata|yeşil salata', 'Side salad'], ['turşu', 'Pickles'], ['cacık', 'Cacık'], ['közlenmiş biber|köz biber', 'Roasted peppers'],
  ['çikolata|çikolatalı', 'Chocolate'], ['bitter çikolata|bitter', 'Dark chocolate'], ['beyaz çikolata', 'White chocolate'], ['sütlü çikolata', 'Milk chocolate'], ['meyveli', 'Fruit'],
  ['frambuazlı|frambuaz', 'Raspberry'], ['çilekli|çilek', 'Strawberry'], ['muzlu|muz', 'Banana'], ['fıstıklı|antep fıstıklı|fıstık', 'Pistachio'], ['cevizli|ceviz', 'Walnut'],
  ['bademli|badem', 'Almond'], ['fındıklı|fındık', 'Hazelnut'], ['karamelli', 'Caramel'], ['vanilyalı', 'Vanilla'], ['naneli|nane', 'Mint'], ['tarçınlı|tarçın', 'Cinnamon'], ['kakaolu|kakao', 'Cocoa'],
];
// The same Turkish word reads differently by group: "Sade" coffee has no sugar, "Orta" steak is medium, "Orta" kebab is medium spicy.
const contextEntries: [RegExp, [string, string][]][] = [
  [/seker|tatlilik/, [['sade', 'No sugar'], ['orta', 'Medium sweet'], ['şekerli', 'Sweet'], ['az', 'A little sugar'], ['çok|bol', 'Extra sweet']]],
  [/(^|\s)aci(?!k)/, [['orta', 'Medium spicy'], ['az', 'Mildly spicy'], ['çok|bol', 'Extra spicy'], ['yok', 'Not spicy'], ['var', 'Spicy']]],
  [/pisme|pisirme derece/, [['orta', 'Medium'], ['az', 'Rare'], ['iyi|tam', 'Well done'], ['orta az', 'Medium rare'], ['orta iyi', 'Medium well']]],
  [/^boy|boyut|bardak/, [['orta', 'Medium'], ['standart|normal', 'Regular']]],
  [/serbet/, [['az', 'Light syrup'], ['bol|çok', 'Extra syrup'], ['yok', 'No syrup']]],
  [/buz/, [['az', 'Light ice'], ['bol|çok', 'Extra ice'], ['yok', 'No ice']]],
  [/sogan/, [['var|olsun', 'With onion'], ['yok|olmasın', 'No onion'], ['az', 'A little onion']]],
  [/sarimsak/, [['var|olsun', 'With garlic'], ['yok|olmasın', 'No garlic']]],
  [/^dem/, [['açık', 'Light'], ['orta', 'Medium'], ['koyu|demli', 'Strong']]],
];
const toMap = (list: [string, string][]) => new Map(list.flatMap(([tr, en]) => tr.split('|').map(t => [menuLabelKey(t), en] as const)));
const optionDictionary = toMap(optionEntries), contextDictionaries = contextEntries.map(([rule, list]) => [rule, toMap(list)] as const);
// Counted options ("4 kişilik", "2 top") keep the owner's number.
const counted: [RegExp, (n: string) => string][] = [[/^(\d+) kisilik$/, n => `Serves ${n}`], [/^(\d+) top$/, n => `${n} scoop${n === '1' ? '' : 's'}`], [/^(\d+) dilim$/, n => `${n} slice${n === '1' ? '' : 's'}`], [/^(\d+) adet$/, n => `${n} pcs`], [/^(\d+) shot$/, n => `${n} shot${n === '1' ? '' : 's'}`]];

/** Dictionary suggestion for an option group name, or for an option when its group's Turkish name is given. */
export function optionLabelSuggestion(label: string, group?: string) {
  const key = menuLabelKey(label), groupKey = group === undefined ? undefined : menuLabelKey(group);
  const own = groupKey === undefined ? undefined : contextDictionaries.find(([rule, words]) => rule.test(groupKey) && words.has(key))?.[1].get(key);
  if (own || optionDictionary.has(key)) return own ?? optionDictionary.get(key);
  for (const [rule, text] of counted) { const m = rule.exec(key); if (m) return text(m[1]); }
  return undefined;
}
/** Owner's English, else dictionary, else the Turkish text. */
export function optionLabelEn(label: string, custom?: string, group?: string) { return custom?.trim() || optionLabelSuggestion(label, group) || label; }
type NamedEn = { name: string; nameEn?: string };
export const groupNameEn = (g: NamedEn) => optionLabelEn(g.name, g.nameEn);
export const optionNameEn = (g: NamedEn, o: NamedEn) => optionLabelEn(o.name, o.nameEn, g.name);
type ProductText = { name: string; nameEn?: string; description: string; descriptionEn?: string; ingredients?: string; ingredientsEn?: string };
/** Product name, description and ingredients on the EN menu: the owner's English or the Turkish text (free text has no dictionary). */
export const productTextEn = (p: ProductText) => ({ name: p.nameEn?.trim() || p.name, description: p.descriptionEn?.trim() || p.description, ingredients: p.ingredientsEn?.trim() || p.ingredients });
type LineOptions = { productId: string; name: string; selections: { groupId: string; optionId: string }[]; optionNames: string[] };
type MenuProduct = { id: string; name: string; nameEn?: string; groups: { id: string; name: string; nameEn?: string; options: { id: string; name: string; nameEn?: string }[] }[] };
/** A saved line's options in English for the guest's own order. Kitchen text stays Turkish in the order; the current menu
 * supplies the owner's English while the option still has the saved name, otherwise the dictionary reads the saved name. */
export function lineOptionNamesEn(line: LineOptions, products: readonly MenuProduct[]) {
  const p = products.find(p => p.id === line.productId);
  return line.optionNames.map((name, i) => {
    const s = line.selections[i], g = p?.groups.find(g => g.id === s?.groupId), o = g?.options.find(o => o.id === s?.optionId);
    return g && o?.name === name ? optionNameEn(g, o) : optionLabelEn(name, undefined, g?.name);
  });
}
/** A saved line's product name in English: the menu's English name while the product keeps the saved Turkish name. */
export function lineNameEn(line: Pick<LineOptions, 'productId' | 'name'>, products: readonly MenuProduct[]) {
  const p = products.find(p => p.id === line.productId);
  return p && p.name === line.name && p.nameEn?.trim() || line.name;
}
