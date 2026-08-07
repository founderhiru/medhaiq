// company-dataset.js
// Reusable list of globally recognized employers, used today by the
// "Tailor your Interview" Target Company autocomplete
// (views/interview-setup.ejs). Deliberately framework-free (a plain
// global array, not an ES module) — this codebase has no bundler, every
// other client script here is a plain <script src> or inline <script>
// tag, so this matches the existing pattern rather than introducing a
// new one.
//
// Reuse: any future feature that needs "a list of known companies"
// (Resume Intelligence, Company Intelligence, Company Interview
// Libraries, etc.) should include this same file and read
// window.MedhaIQCompanies rather than maintaining a second copy.
//
// Data shape: each entry is an object — { name: 'Microsoft' } — not a
// plain string, even though `name` is the only field populated today.
// This is deliberate: future Company Intelligence work (industry,
// interview style, leadership principles/frameworks, aliases, etc.) can
// add fields to these same objects with zero migration of the existing
// 400+ entries and zero changes to company-autocomplete.js, which
// already reads `.name` off each entry. Ordering: alphabetical within
// each category, to make future additions/edits easy to place by hand.

(function () {
  var COMPANIES = [
    // ── Big Tech ──────────────────────────────────────────────
    { name: 'Activision Blizzard' }, { name: 'Adobe' }, { name: 'Airbnb' },
    { name: 'Alibaba' }, { name: 'Alphabet' }, { name: 'Amazon' }, { name: 'AMD' },
    { name: 'Anthropic' }, { name: 'Apple' }, { name: 'Arm Holdings' }, { name: 'ASML' },
    { name: 'Atlassian' }, { name: 'Baidu' }, { name: 'Box' }, { name: 'Broadcom' },
    { name: 'ByteDance' }, { name: 'Cisco' }, { name: 'Cloudflare' }, { name: 'Confluent' },
    { name: 'CrowdStrike' }, { name: 'Databricks' }, { name: 'Datadog' },
    { name: 'Dell Technologies' }, { name: 'DigitalOcean' }, { name: 'DoorDash' },
    { name: 'Dropbox' }, { name: 'eBay' }, { name: 'Elastic' }, { name: 'Electronic Arts' },
    { name: 'Epic Games' }, { name: 'Etsy' }, { name: 'GitHub' }, { name: 'GitLab' },
    { name: 'Google' }, { name: 'Hewlett Packard Enterprise' }, { name: 'HP Inc.' },
    { name: 'Huawei' }, { name: 'HubSpot' }, { name: 'IBM' }, { name: 'Intel' },
    { name: 'JD.com' }, { name: 'LG Electronics' }, { name: 'LinkedIn' }, { name: 'Lyft' },
    { name: 'Meta' }, { name: 'Micron Technology' }, { name: 'Microsoft' },
    { name: 'MongoDB' }, { name: 'Netflix' }, { name: 'NVIDIA' }, { name: 'Okta' },
    { name: 'OpenAI' }, { name: 'Oracle' }, { name: 'Palantir' },
    { name: 'Palo Alto Networks' }, { name: 'PayPal' }, { name: 'Pinterest' },
    { name: 'Qualcomm' }, { name: 'Reddit' }, { name: 'Rivian' }, { name: 'Roblox' },
    { name: 'Salesforce' }, { name: 'Samsung' }, { name: 'SAP' },
    { name: 'Seagate Technology' }, { name: 'ServiceNow' }, { name: 'Shopify' },
    { name: 'Slack' }, { name: 'Snap' }, { name: 'Snowflake' }, { name: 'Sony' },
    { name: 'SpaceX' }, { name: 'Splunk' }, { name: 'Spotify' }, { name: 'Square (Block)' },
    { name: 'Stripe' }, { name: 'Take-Two Interactive' }, { name: 'Tencent' },
    { name: 'Tesla' }, { name: 'Texas Instruments' }, { name: 'TSMC' }, { name: 'Twilio' },
    { name: 'Uber' }, { name: 'Unity' }, { name: 'VMware' }, { name: 'Waymo' },
    { name: 'Western Digital' }, { name: 'Workday' }, { name: 'X (Twitter)' },
    { name: 'Xiaomi' }, { name: 'Zoom' },

    // ── AI / Frontier labs ───────────────────────────────────
    { name: 'Character.AI' }, { name: 'Cohere' }, { name: 'DeepMind' },
    { name: 'Hugging Face' }, { name: 'Inflection AI' }, { name: 'Mistral AI' },
    { name: 'Perplexity AI' }, { name: 'Scale AI' }, { name: 'Stability AI' },

    // ── Fortune 500 / Diversified ────────────────────────────
    { name: '3M' }, { name: 'AbbVie' }, { name: 'Adidas' }, { name: 'Airbus' },
    { name: 'American Airlines' }, { name: 'Anthem (Elevance Health)' },
    { name: 'AstraZeneca' }, { name: 'Berkshire Hathaway' }, { name: 'BMW Group' },
    { name: 'Boeing' }, { name: 'BP' }, { name: 'Bristol Myers Squibb' },
    { name: 'Caterpillar' }, { name: 'Chevron' }, { name: 'Chipotle Mexican Grill' },
    { name: 'Cigna' }, { name: 'Coca-Cola' }, { name: 'Comcast (NBCUniversal)' },
    { name: 'ConocoPhillips' }, { name: 'Costco' }, { name: 'CVS Health' },
    { name: 'Delta Air Lines' }, { name: 'DHL' }, { name: 'Disney' },
    { name: "Domino's Pizza" }, { name: 'Duke Energy' }, { name: 'Eli Lilly' },
    { name: 'Emirates' }, { name: 'Estée Lauder' }, { name: 'ExxonMobil' }, { name: 'FedEx' },
    { name: 'Ford Motor Company' }, { name: 'General Electric' }, { name: 'General Motors' },
    { name: 'GlaxoSmithKline' }, { name: 'Hilton Worldwide' }, { name: 'Home Depot' },
    { name: 'Honda' }, { name: 'Honeywell' }, { name: 'Hyatt Hotels' }, { name: 'Hyundai' },
    { name: 'John Deere' }, { name: 'Johnson & Johnson' }, { name: 'Kaiser Permanente' },
    { name: "Kellogg's" }, { name: "L'Oréal" }, { name: 'Lockheed Martin' },
    { name: "Lowe's" }, { name: 'Maersk' }, { name: 'Marriott International' },
    { name: "McDonald's" }, { name: 'Mercedes-Benz Group' }, { name: 'Merck & Co.' },
    { name: 'Moderna' }, { name: 'Nestlé' }, { name: 'News Corp' },
    { name: 'NextEra Energy' }, { name: 'Nike' }, { name: 'Northrop Grumman' },
    { name: 'Novartis' }, { name: 'Paramount Global' }, { name: 'PepsiCo' },
    { name: 'Pfizer' }, { name: 'Procter & Gamble' }, { name: 'Puma' },
    { name: 'Qatar Airways' }, { name: 'Raytheon Technologies' }, { name: 'Roche' },
    { name: 'Sanofi' }, { name: 'Shell' }, { name: 'Singapore Airlines' },
    { name: 'Southwest Airlines' }, { name: 'Starbucks' }, { name: 'Stellantis' },
    { name: 'Target' }, { name: 'The New York Times Company' }, { name: 'TotalEnergies' },
    { name: 'Toyota' }, { name: 'Under Armour' }, { name: 'Unilever' },
    { name: 'Union Pacific' }, { name: 'United Airlines' }, { name: 'UnitedHealth Group' },
    { name: 'UPS' }, { name: 'Volkswagen Group' }, { name: 'Walmart' },
    { name: 'Warner Bros. Discovery' }, { name: 'Yum! Brands' },

    // ── Financial Services ───────────────────────────────────
    { name: 'AIG' }, { name: 'Allstate' }, { name: 'American Express' },
    { name: 'Andreessen Horowitz' }, { name: 'Apollo Global Management' },
    { name: 'Axis Bank' }, { name: 'Bank of America' }, { name: 'Barclays' },
    { name: 'Berkshire Hathaway Insurance' }, { name: 'BlackRock' }, { name: 'Blackstone' },
    { name: 'BNP Paribas' }, { name: 'Carlyle Group' }, { name: 'Charles Schwab' },
    { name: 'Chubb' }, { name: 'Citigroup' }, { name: 'CME Group' },
    { name: 'Credit Suisse' }, { name: 'DBS Bank' }, { name: 'Deutsche Bank' },
    { name: 'Fidelity Investments' }, { name: 'Goldman Sachs' }, { name: 'HDFC Bank' },
    { name: 'HSBC' }, { name: 'ICICI Bank' }, { name: 'Intercontinental Exchange' },
    { name: 'JPMorgan Chase' }, { name: 'KKR' }, { name: 'Kotak Mahindra Bank' },
    { name: 'Mastercard' }, { name: 'MetLife' }, { name: 'Mitsubishi UFJ Financial Group' },
    { name: 'Morgan Stanley' }, { name: 'Munich Re' }, { name: 'Nasdaq' }, { name: 'Nomura' },
    { name: 'Progressive' }, { name: 'Prudential Financial' },
    { name: 'Royal Bank of Canada' }, { name: 'Sequoia Capital' },
    { name: 'Société Générale' }, { name: 'SoftBank Group' }, { name: 'Standard Chartered' },
    { name: 'State Bank of India' }, { name: 'State Street' },
    { name: 'Tiger Global Management' }, { name: 'Toronto-Dominion Bank' }, { name: 'UBS' },
    { name: 'Vanguard Group' }, { name: 'Visa' }, { name: 'Warburg Pincus' },
    { name: 'Wells Fargo' }, { name: 'Zurich Insurance Group' },

    // ── Consulting & Professional Services ───────────────────
    { name: 'A.T. Kearney' }, { name: 'Accenture' }, { name: 'Bain & Company' },
    { name: 'Booz Allen Hamilton' }, { name: 'Boston Consulting Group' },
    { name: 'Capgemini' }, { name: 'Cognizant' }, { name: 'Deloitte' }, { name: 'EY' },
    { name: 'IBM Consulting' }, { name: 'KPMG' }, { name: 'L.E.K. Consulting' },
    { name: 'McKinsey & Company' }, { name: 'Oliver Wyman' }, { name: 'PwC' },
    { name: 'Roland Berger' }, { name: 'Strategy&' },

    // ── IT Services / Indian Tech ─────────────────────────────
    { name: 'Birlasoft' }, { name: 'Coforge' }, { name: 'Cyient' },
    { name: 'Happiest Minds Technologies' }, { name: 'HCLTech' },
    { name: 'Hexaware Technologies' }, { name: 'Infosys' },
    { name: 'L&T Technology Services' }, { name: 'LTIMindtree' }, { name: 'Mphasis' },
    { name: 'Persistent Systems' }, { name: 'Tata Consultancy Services' },
    { name: 'Tech Mahindra' }, { name: 'Wipro' }, { name: 'Zensar Technologies' },

    // ── Indian Startups / Unicorns ────────────────────────────
    { name: 'BigBasket' }, { name: 'Blinkit' }, { name: 'boAt' }, { name: 'BrowserStack' },
    { name: 'Byju\'s' }, { name: 'CarDekho' }, { name: 'Cars24' }, { name: 'Chargebee' },
    { name: 'Clevertap' }, { name: 'CRED' }, { name: 'Darwinbox' }, { name: 'Delhivery' },
    { name: 'Dream11' }, { name: 'Druva' }, { name: 'Dunzo' }, { name: 'Flipkart' },
    { name: 'Freshworks' }, { name: 'Games24x7' }, { name: 'Groww' }, { name: 'Icertis' },
    { name: 'InMobi' }, { name: 'Innovaccer' }, { name: 'Lenskart' }, { name: 'Licious' },
    { name: 'Mamaearth' }, { name: 'Meesho' }, { name: 'MoEngage' }, { name: 'MPL' },
    { name: 'Nykaa' }, { name: 'Ola' }, { name: 'Paytm' }, { name: 'PhonePe' },
    { name: 'PhysicsWallah' }, { name: 'PolicyBazaar' }, { name: 'Postman' },
    { name: 'Razorpay' }, { name: 'Rebel Foods' }, { name: 'Shiprocket' }, { name: 'Spinny' },
    { name: 'Swiggy' }, { name: 'Unacademy' }, { name: 'Upstox' }, { name: 'Urban Company' },
    { name: 'Vedantu' }, { name: 'Whatfix' }, { name: 'Zepto' }, { name: 'Zerodha' },
    { name: 'Zoho' }, { name: 'Zomato' },

    // ── GCCs (Global Capability Centers) in India ─────────────
    { name: 'Adobe India' }, { name: 'Airbnb India' },
    { name: 'Amazon Development Centre India' }, { name: 'American Express India' },
    { name: 'Barclays GCC India' }, { name: 'Cisco India' },
    { name: 'Deutsche Bank GCC India' }, { name: 'Goldman Sachs GCC India' },
    { name: 'Google India' }, { name: 'HSBC GCC India' }, { name: 'Intuit India' },
    { name: 'JPMorgan Chase GCC India' }, { name: 'Mastercard India' },
    { name: 'Microsoft India Development Center' }, { name: 'Morgan Stanley GCC India' },
    { name: 'Nomura India' }, { name: 'Salesforce India' }, { name: 'SAP Labs India' },
    { name: 'ServiceNow India' }, { name: 'Standard Chartered GCC India' },
    { name: 'Target India' }, { name: 'Uber India' }, { name: 'UBS India' },
    { name: 'Visa India' }, { name: 'Walmart Global Tech India' },
    { name: 'Wells Fargo India' },

    // ── Ridesharing / Delivery / Gig ──────────────────────────
    { name: 'Deliveroo' }, { name: 'Getir' }, { name: 'Gojek' }, { name: 'Grab' },
    { name: 'Instacart' }, { name: 'Rappi' },

    // ── Telecom ────────────────────────────────────────────────
    { name: 'AT&T' }, { name: 'Bharti Airtel' }, { name: 'China Mobile' },
    { name: 'Deutsche Telekom' }, { name: 'NTT Docomo' }, { name: 'Orange S.A.' },
    { name: 'Reliance Jio' }, { name: 'T-Mobile US' }, { name: 'Telefónica' },
    { name: 'Verizon' }, { name: 'Vodafone' },

    // ── SaaS / Enterprise Software ────────────────────────────
    { name: 'Airtable' }, { name: 'Anaplan' }, { name: 'Asana' }, { name: 'Autodesk' },
    { name: 'Automation Anywhere' }, { name: 'Blue Yonder' }, { name: 'Canva' },
    { name: 'Check Point Software' }, { name: 'Coupa' }, { name: 'DocuSign' },
    { name: 'Figma' }, { name: 'Fortinet' }, { name: 'Intuit' }, { name: 'Miro' },
    { name: 'Monday.com' }, { name: 'Notion' }, { name: 'Pegasystems' }, { name: 'Qualys' },
    { name: 'Rapid7' }, { name: 'RingCentral' }, { name: 'SentinelOne' },
    { name: 'Smartsheet' }, { name: 'Tenable' }, { name: 'UiPath' }, { name: 'Zendesk' },
    { name: 'Zscaler' }, { name: 'Zuora' },

    // ── Retail / E-commerce (Global) ──────────────────────────
    { name: 'Best Buy' }, { name: 'Carvana' }, { name: 'Chewy' }, { name: 'Coupang' },
    { name: 'H&M' }, { name: 'IKEA' }, { name: 'MercadoLibre' }, { name: 'Rakuten' },
    { name: 'Sea Limited (Shopee)' }, { name: 'Sephora' }, { name: 'Wayfair' },
    { name: 'Zara (Inditex)' }
  ];

  window.MedhaIQCompanies = COMPANIES;
})();
