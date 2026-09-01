/* ==========================================================================
   AgriLearn AI Assistant — ai.js
   Runs on dashboard.html only.

   HOW THIS WORKS (demo mode)
   ---------------------------
   1. User sends a prompt -> detectCategory() guesses which topic it is
      (disease / crop recommendation / soil / fertilizer / pesticide) from
      keywords. If nothing matches, the bot asks the user to pick a topic.
   2. The bot then asks 2-4 short clarifying questions for that topic
      (with tap-able quick-reply chips, so the user rarely has to type),
      collecting answers into `flow.answers`.
   3. Once all questions are answered, `buildAnswer()` composes a structured
      reply from local lookup tables in KNOWLEDGE_BASE.
   4. The "Crop Plan Map" card skips chat and opens a short form, then
      renders a proportioned field mosaic from the same crop knowledge base.

   HOOK UP A REAL AI (recommended before shipping)
   -------------------------------------------------
   Do NOT call an LLM API directly from this client-side file — that would
   expose your API key. Instead, replace `buildAnswer()` / `askAI()` calls
   with a fetch to your own backend, which calls Claude server-side:

     async function askAI(category, prompt, answers) {
       const res = await fetch('/api/ai/ask', {
         method: 'POST',
         headers: { 'Content-Type': 'application/json' },
         body: JSON.stringify({ category, prompt, answers })
       });
       return (await res.json()).answerHtml;
     }

   On the server (Node/Express, matching the rest of the AgriLearn backend):
     - Take { category, prompt, answers } from the request body.
     - Call the Anthropic Messages API (model: a current Claude model —
       check docs.claude.com for the latest string) with a system prompt
       describing AgriLearn's tone and the user's answers as context.
     - Return the model's text back to the client.
   Keep your Anthropic API key server-side only (env var), never in this file.
   ========================================================================== */

(function () {
  "use strict";

  const $ = (sel, ctx = document) => ctx.querySelector(sel);
  const $$ = (sel, ctx = document) => Array.from(ctx.querySelectorAll(sel));

  const log = $("#ai-log");
  if (!log) return; // not on dashboard.html

  const composerForm = $("#ai-composer-form");
  const composerInput = $("#ai-input");

  /* ------------------------------------------------------------------ */
  /* Knowledge base (demo data — swap for real content / real AI)        */
  /* ------------------------------------------------------------------ */

  const CROP_DB = [
    { name: "Rice (paddy)", season: ["kharif"], soil: ["clayey", "alluvial"], water: ["full"], color: "#2C6E49" },
    { name: "Maize", season: ["kharif", "rabi"], soil: ["loamy", "alluvial", "red"], water: ["partial", "full"], color: "#D9A441" },
    { name: "Cotton", season: ["kharif"], soil: ["black", "loamy"], water: ["partial"], color: "#6B8CAE" },
    { name: "Groundnut", season: ["kharif"], soil: ["red", "sandy", "loamy"], water: ["partial", "rain"], color: "#B4832B" },
    { name: "Redgram (tur/arhar)", season: ["kharif"], soil: ["black", "red", "loamy"], water: ["rain", "partial"], color: "#7C8B4B" },
    { name: "Blackgram / Greengram", season: ["kharif", "zaid"], soil: ["loamy", "red", "black"], water: ["rain", "partial"], color: "#3C6E71" },
    { name: "Chilli", season: ["kharif", "rabi"], soil: ["red", "loamy", "black"], water: ["partial", "full"], color: "#A5462F" },
    { name: "Turmeric", season: ["kharif"], soil: ["loamy", "red"], water: ["partial", "full"], color: "#D9A441" },
    { name: "Sugarcane", season: ["kharif"], soil: ["loamy", "alluvial", "clayey"], water: ["full"], color: "#2C6E49" },
    { name: "Wheat", season: ["rabi"], soil: ["loamy", "alluvial", "clayey"], water: ["partial", "full"], color: "#B4832B" },
    { name: "Mustard", season: ["rabi"], soil: ["loamy", "sandy", "alluvial"], water: ["rain", "partial"], color: "#D9A441" },
    { name: "Chickpea (bengal gram)", season: ["rabi"], soil: ["black", "loamy"], water: ["rain", "partial"], color: "#7C8B4B" },
    { name: "Bengal gram / gram", season: ["rabi"], soil: ["black", "clayey"], water: ["rain"], color: "#6B8CAE" },
    { name: "Sunflower", season: ["rabi", "zaid"], soil: ["loamy", "black", "red"], water: ["partial"], color: "#D9A441" },
    { name: "Watermelon / muskmelon", season: ["zaid"], soil: ["sandy", "loamy", "alluvial"], water: ["partial", "full"], color: "#A5462F" },
    { name: "Vegetables (tomato, brinjal, okra)", season: ["kharif", "rabi", "zaid"], soil: ["loamy", "red", "alluvial"], water: ["partial", "full"], color: "#2C6E49" },
    { name: "Millets (jowar/bajra/ragi)", season: ["kharif", "rabi"], soil: ["red", "sandy", "black"], water: ["rain"], color: "#B4832B" },
    { name: "Soybean", season: ["kharif"], soil: ["black", "loamy"], water: ["rain", "partial"], color: "#3C6E71" },
  ];

  function recommendCrops({ soil, season, water }, count = 4) {
    const scored = CROP_DB.map((c) => {
      let score = 0;
      if (season && c.season.includes(season)) score += 3;
      if (soil && c.soil.includes(soil)) score += 2;
      if (water && c.water.includes(water)) score += 1;
      return { ...c, score };
    })
      .filter((c) => c.score > 0)
      .sort((a, b) => b.score - a.score);

    const picked = (scored.length ? scored : CROP_DB).slice(0, count);
    const shareSteps = [40, 30, 20, 10, 8, 6];
    const total = shareSteps.slice(0, picked.length).reduce((a, b) => a + b, 0);
    return picked.map((c, i) => ({
      ...c,
      share: Math.round((shareSteps[i] / total) * 100),
    }));
  }

  const DISEASE_DB = [
    { crop: "rice", symptom: "yellowing", name: "Bacterial leaf blight / nitrogen stress", advice: "Check for water-soaked leaf-tip streaks turning yellow — likely bacterial blight, worse in standing water. Drain excess water, avoid excess nitrogen, and use a resistant variety next season. If tips aren't streaked, it may just be nitrogen deficiency — a light urea top-dress can help." },
    { crop: "rice", symptom: "spots", name: "Blast disease", advice: "Diamond-shaped grey-centered spots on leaves point to rice blast. Avoid excess nitrogen, ensure good drainage, and a recommended fungicide (e.g. a tricyclazole-based product, per the label) at early symptom onset limits spread." },
    { crop: "tomato", symptom: "spots", name: "Early blight / leaf spot", advice: "Concentric brown rings on lower leaves are classic early blight. Remove affected leaves, avoid overhead watering, mulch the base, and rotate a copper-based or other labelled fungicide on a 7-10 day schedule if it spreads." },
    { crop: "tomato", symptom: "wilting", name: "Bacterial wilt / fusarium wilt", advice: "Sudden wilting with green leaves (no yellowing first) often points to bacterial wilt in the soil — hard to cure this season; remove affected plants and avoid replanting tomato/brinjal family there for 2-3 seasons. Gradual yellow-then-wilt is more typical of fusarium — use resistant varieties next time." },
    { crop: "cotton", symptom: "yellowing", name: "Nutrient deficiency or leaf reddening", advice: "In cotton, interveinal yellowing/reddening in older leaves is often magnesium or potassium deficiency, common on light soils. A foliar spray of the deficient nutrient plus balanced basal fertilizer usually corrects it within 1-2 weeks." },
    { crop: "chilli", symptom: "white powder", name: "Powdery mildew", advice: "White powdery patches on chilli leaves are powdery mildew, worse in humid, low-airflow conditions. Improve spacing/airflow, remove heavily infected leaves, and a sulfur-based or other labelled fungicide controls it well if caught early." },
    { crop: "maize", symptom: "holes", name: "Fall armyworm damage", advice: "Ragged holes and sawdust-like frass in the whorl are classic fall armyworm. Scout early morning, handpick if the field is small, and if damage is spreading, a labelled insecticide targeted at the whorl (following the label's timing and dose) is most effective." },
    { crop: "default", symptom: "yellowing", name: "Nutrient deficiency (likely nitrogen)", advice: "General yellowing that starts on older leaves and moves upward is the classic sign of nitrogen deficiency. A soil or leaf test will confirm, but a moderate nitrogen top-dress plus organic matter usually helps within 1-2 weeks." },
    { crop: "default", symptom: "spots", name: "Fungal leaf spot (general)", advice: "Discrete spots, often with a ring or halo, are usually fungal and spread faster in humid weather. Remove and destroy affected leaves, improve airflow/spacing, and avoid wetting foliage when watering." },
    { crop: "default", symptom: "wilting", name: "Root stress, wilt disease, or water issue", advice: "Wilting can mean root/vascular disease, waterlogging, or drought stress depending on soil moisture. Check soil moisture first — if it's wet and the plant still wilts, suspect a soil-borne wilt disease; if dry, it's likely water stress." },
    { crop: "default", symptom: "white powder", name: "Powdery mildew (general)", advice: "White, powdery coating on leaves is powdery mildew — common in humid, still air. Increase spacing and airflow, remove badly affected leaves, and a sulfur-based fungicide (per label) controls most cases." },
    { crop: "default", symptom: "rotting", name: "Root or stem rot", advice: "Soft, dark, rotting tissue at the stem base usually means waterlogging or a soil fungus (e.g. Pythium/Fusarium). Improve drainage first — that alone often stops it — and avoid replanting the same spot immediately." },
  ];

  function findDisease({ crop, symptom }) {
    const cropKey = (crop || "").toLowerCase();
    const symKey = (symptom || "").toLowerCase();
    return (
      DISEASE_DB.find((d) => cropKey.includes(d.crop) && symKey.includes(d.symptom)) ||
      DISEASE_DB.find((d) => d.crop === "default" && symKey.includes(d.symptom)) ||
      { name: "Needs a closer look", advice: "That combination isn't in my quick-reference list. Try describing exactly what you see (leaf color, spot shape, where on the plant) or share a photo with your local Krishi Vigyan Kendra / agricultural extension officer for a confirmed diagnosis." }
    );
  }

  const SOIL_GUIDE = {
    clayey: { name: "Clayey soil", desc: "Holds water and nutrients well but drains slowly and can compact easily.", crops: "Rice, sugarcane, wheat, most vegetables with good drainage prep.", fix: "Add organic matter/compost yearly to improve structure and drainage; avoid working it when wet." },
    sandy: { name: "Sandy soil", desc: "Drains fast and warms up quickly, but doesn't hold water or nutrients long.", crops: "Groundnut, millets, watermelon, root vegetables.", fix: "Add compost/farmyard manure to boost water and nutrient retention; irrigate more often in smaller amounts." },
    loamy: { name: "Loamy soil", desc: "A balanced mix of sand, silt and clay — generally the most fertile and easiest to work.", crops: "Almost anything: cereals, pulses, vegetables, cotton.", fix: "Maintain with regular organic matter and crop rotation to keep it in good shape." },
    black: { name: "Black (cotton) soil", desc: "Rich in clay and nutrients, holds moisture very well, but is sticky when wet and cracks when dry.", crops: "Cotton, soybean, chickpea, sunflower, redgram.", fix: "Time field operations around moisture — avoid working right after rain; deep ploughing between seasons helps aeration." },
    red: { name: "Red soil", desc: "Iron-rich, generally lower in nitrogen and organic matter, moderate drainage.", crops: "Groundnut, millets, redgram, chilli, turmeric.", fix: "Regular organic matter and a balanced nitrogen/phosphorus schedule make a big difference here." },
    alluvial: { name: "Alluvial soil", desc: "Fertile, river-deposited soil, generally good for a wide range of crops.", crops: "Rice, wheat, sugarcane, maize, vegetables.", fix: "Usually needs the least correction — focus on balanced fertilization and good irrigation scheduling." },
  };

  const FERTILIZER_GUIDE = {
    seedling: "At sowing/seedling stage, focus on phosphorus for root establishment plus a modest nitrogen base — heavy nitrogen too early can push weak, leggy growth.",
    vegetative: "During vegetative growth, nitrogen is the main driver of leafy growth — split it into 2-3 doses rather than one large application to reduce waste and leaching.",
    flowering: "At flowering, ease off nitrogen and lean toward potassium and phosphorus — they support flower set and fruit development better than nitrogen at this stage.",
    fruiting: "During fruiting/grain-fill, potassium supports fruit quality and grain fill; a balanced foliar feed can help if the crop looks stressed.",
  };

  const PESTICIDE_GUIDE = {
    aphids: { name: "Aphids", organic: "Neem oil spray (2%) every 5-7 days, or a strong soap-water spray, targeting the underside of leaves. Ladybird beetles are natural predators — avoid broad-spectrum sprays that kill them too.", chemical: "A labelled systemic insecticide (e.g. imidacloprid-based) works well on aphids — always follow the label's dose and the pre-harvest interval." },
    caterpillars: { name: "Caterpillars/larvae", organic: "Bacillus thuringiensis (Bt)-based biopesticide is very effective and safe for beneficial insects. Handpicking works for small plots.", chemical: "A labelled insecticide targeted at the crop's growth stage; spray in the evening to protect pollinators." },
    whiteflies: { name: "Whiteflies", organic: "Yellow sticky traps plus neem oil spray on the underside of leaves; reflective mulch can also deter them.", chemical: "A labelled systemic insecticide works, but rotate chemical groups to avoid resistance building up." },
    "stem borer": { name: "Stem borer", organic: "Pheromone traps for early detection, plus removing and destroying affected stems/dead-hearts.", chemical: "A labelled granular or systemic insecticide applied at the base, timed to egg-hatch stage for best effect." },
  };

  /* ------------------------------------------------------------------ */
  /* Category / question definitions                                     */
  /* ------------------------------------------------------------------ */

  const CATEGORIES = {
    disease: {
      label: "Crop disease / pest ID",
      keywords: ["disease", "pest", "infect", "spot", "wilt", "yellow", "fungus", "blight", "rot", "insect", "bug", "sick", "damage"],
      questions: [
        { key: "crop", text: "Which crop is affected?", chips: ["Rice", "Wheat", "Cotton", "Maize", "Tomato", "Chilli", "Sugarcane", "Something else"] },
        { key: "symptom", text: "What are you seeing on the plant?", chips: ["Yellowing", "Spots", "Wilting", "White powder", "Holes", "Rotting"] },
        { key: "duration", text: "How long has this been going on?", chips: ["1-3 days", "About a week", "2+ weeks"] },
      ],
      finish: (a) => {
        const d = findDisease({ crop: a.crop, symptom: a.symptom });
        return `
          <h4>Likely cause: ${d.name}</h4>
          <p>${d.advice}</p>
          <div class="ai-note">⚠️ This is general guidance, not a lab-confirmed diagnosis. For chemical control, always follow the product label's dose and pre-harvest interval — when unsure, check with your local agricultural extension officer.</div>`;
      },
    },
    crop: {
      label: "Crop recommendation",
      keywords: ["which crop", "what to grow", "best crop", "recommend crop", "crop suggestion", "what should i grow", "what should i plant"],
      questions: [
        { key: "soil", text: "What's your soil type?", chips: ["Loamy", "Clayey", "Sandy", "Black", "Red", "Alluvial", "Not sure"], map: { "Loamy": "loamy", "Clayey": "clayey", "Sandy": "sandy", "Black": "black", "Red": "red", "Alluvial": "alluvial", "Not sure": "loamy" } },
        { key: "season", text: "Which growing season?", chips: ["Kharif (Jun-Oct)", "Rabi (Oct-Mar)", "Zaid (Mar-Jun)"], map: { "Kharif (Jun-Oct)": "kharif", "Rabi (Oct-Mar)": "rabi", "Zaid (Mar-Jun)": "zaid" } },
        { key: "water", text: "Water availability?", chips: ["Rain-fed only", "Partial irrigation", "Full irrigation"], map: { "Rain-fed only": "rain", "Partial irrigation": "partial", "Full irrigation": "full" } },
      ],
      finish: (a) => {
        const crops = recommendCrops({ soil: a.soil, season: a.season, water: a.water }, 4);
        const items = crops.map((c) => `<li><strong>${c.name}</strong> — good fit for your soil/season/water combination (~${c.share}% of the mix)</li>`).join("");
        return `
          <h4>Suggested crops for your conditions</h4>
          <ul>${items}</ul>
          <div class="ai-note">🌱 Want a visual field layout for these? Try the <strong>Crop Plan Map</strong> card in the sidebar.</div>`;
      },
    },
    soil: {
      label: "Soil type & health",
      keywords: ["soil type", "soil test", "soil ph", "soil quality", "my soil"],
      questions: [
        { key: "feel", text: "How would you describe your soil?", chips: ["Sticky when wet, cracks when dry", "Gritty, drains fast", "Dark, crumbly, holds moisture", "Reddish, porous", "Not sure"], map: { "Sticky when wet, cracks when dry": "black", "Gritty, drains fast": "sandy", "Dark, crumbly, holds moisture": "loamy", "Reddish, porous": "red", "Not sure": "loamy" } },
        { key: "ph", text: "Do you know your soil pH?", chips: ["Acidic (below 6.5)", "Neutral (6.5-7.5)", "Alkaline (above 7.5)", "Don't know"] },
      ],
      finish: (a) => {
        const s = SOIL_GUIDE[a.feel] || SOIL_GUIDE.loamy;
        const phNote =
          a.ph === "Acidic (below 6.5)" ? "Acidic soil can limit nutrient uptake — agricultural lime, applied per a soil test's recommendation, helps bring pH up gradually." :
          a.ph === "Alkaline (above 7.5)" ? "Alkaline soil can lock up micronutrients like iron and zinc — organic matter and, if needed, elemental sulfur (per a soil test) help lower pH over time." :
          "Neutral pH is ideal for most crops — no correction usually needed.";
        return `
          <h4>${s.name}</h4>
          <p>${s.desc}</p>
          <h4>Good crop fits</h4>
          <p>${s.crops}</p>
          <h4>Improving it</h4>
          <p>${s.fix} ${a.ph && a.ph !== "Don't know" ? phNote : "A proper lab soil test (available from most state agriculture departments) will give you an exact pH and nutrient reading — well worth it once a season."}</p>`;
      },
    },
    fertilizer: {
      label: "Fertilizer guidance",
      keywords: ["fertilizer", "fertiliser", "nutrient", "npk", "urea", "compost", "manure"],
      questions: [
        { key: "stage", text: "What growth stage is the crop at?", chips: ["Sowing/seedling", "Vegetative growth", "Flowering", "Fruiting"], map: { "Sowing/seedling": "seedling", "Vegetative growth": "vegetative", "Flowering": "flowering", "Fruiting": "fruiting" } },
        { key: "pref", text: "Organic or chemical fertilizer?", chips: ["Organic only", "Chemical/synthetic", "Either / mixed"] },
      ],
      finish: (a) => {
        const stageAdvice = FERTILIZER_GUIDE[a.stage] || FERTILIZER_GUIDE.vegetative;
        const prefNote =
          a.pref === "Organic only" ? "Lean on well-rotted farmyard manure, compost, and vermicompost — they release nutrients more slowly, so apply a bit earlier than you would a chemical fertilizer." :
          a.pref === "Chemical/synthetic" ? "Split chemical fertilizer doses (2-3 applications) instead of one large dose — it reduces waste and runoff and matches what the plant can actually use at each stage." :
          "A mixed approach works well: organic matter as a base for soil health, topped up with a smaller, targeted dose of chemical fertilizer at key growth stages.";
        return `
          <h4>At this growth stage</h4>
          <p>${stageAdvice}</p>
          <h4>Your preference</h4>
          <p>${prefNote}</p>
          <div class="ai-note">📋 Exact dosage depends on your crop and soil test results — this is general timing/type guidance, not a fixed dose.</div>`;
      },
    },
    pesticide: {
      label: "Pest control",
      keywords: ["pesticide", "insecticide", "pest control", "spray", "kill bugs", "control pest"],
      questions: [
        { key: "pest", text: "Which pest are you dealing with?", chips: ["Aphids", "Caterpillars", "Whiteflies", "Stem borer", "Not sure"] },
        { key: "pref", text: "Preference for control method?", chips: ["Organic/biological", "Chemical", "Integrated (mix of both)"] },
      ],
      finish: (a) => {
        const key = (a.pest || "").toLowerCase();
        const p = PESTICIDE_GUIDE[key];
        if (!p) {
          return `
            <h4>Let's narrow it down</h4>
            <p>I don't have that exact pest in my quick-reference list. Look closely at where the damage is (leaves, stem, roots, fruit) and whether you can see the insect itself — that's usually enough for your local agri-input store or extension officer to identify it correctly and recommend a labelled product.</p>`;
        }
        const method = a.pref === "Chemical" ? p.chemical : a.pref === "Organic/biological" ? p.organic : `${p.organic} ${p.chemical}`;
        return `
          <h4>${p.name}</h4>
          <p>${method}</p>
          <div class="ai-note">🧪 Always read the product label: correct dose, target pest, and pre-harvest interval. Wear recommended protective equipment when spraying.</div>`;
      },
    },
  };

  /* ------------------------------------------------------------------ */
  /* Chat rendering                                                       */
  /* ------------------------------------------------------------------ */

  function scrollToBottom() {
    log.scrollTop = log.scrollHeight;
  }

  function addUserMessage(text) {
    const el = document.createElement("div");
    el.className = "ai-msg ai-msg--user";
    el.innerHTML = `<span class="ai-msg__avatar">You</span><span class="ai-msg__bubble"></span>`;
    el.querySelector(".ai-msg__bubble").textContent = text;
    log.appendChild(el);
    scrollToBottom();
  }

  function addBotMessage(html, { chips = null, onChip = null } = {}) {
    const el = document.createElement("div");
    el.className = "ai-msg ai-msg--bot";
    el.innerHTML = `<span class="ai-msg__avatar">AI</span><span class="ai-msg__bubble"></span>`;
    const bubble = el.querySelector(".ai-msg__bubble");
    bubble.innerHTML = html;

    if (chips && chips.length) {
      const chipRow = document.createElement("div");
      chipRow.className = "ai-chips";
      chips.forEach((label) => {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "ai-chip";
        btn.textContent = label;
        btn.addEventListener("click", () => {
          $$(".ai-chip", chipRow).forEach((c) => (c.disabled = true));
          onChip && onChip(label);
        });
        chipRow.appendChild(btn);
      });
      bubble.appendChild(chipRow);
    }
    log.appendChild(el);
    scrollToBottom();
    return el;
  }

  function addTypingIndicator() {
    const el = document.createElement("div");
    el.className = "ai-msg ai-msg--bot";
    el.innerHTML = `<span class="ai-msg__avatar">AI</span><span class="ai-msg__bubble"><span class="ai-typing"><span></span><span></span><span></span></span></span>`;
    log.appendChild(el);
    scrollToBottom();
    return el;
  }

  /* ------------------------------------------------------------------ */
  /* Conversation flow state machine                                     */
  /* ------------------------------------------------------------------ */

  let flow = null; // { categoryKey, answers: {}, step, originalPrompt }

  function detectCategory(text) {
    const t = text.toLowerCase();
    let best = null, bestHits = 0;
    Object.entries(CATEGORIES).forEach(([key, cat]) => {
      const hits = cat.keywords.filter((k) => t.includes(k)).length;
      if (hits > bestHits) { bestHits = hits; best = key; }
    });
    return bestHits > 0 ? best : null;
  }

  function startCategoryChooser(originalPrompt) {
    flow = { categoryKey: null, answers: {}, step: -1, originalPrompt, awaitingCategoryChoice: true };
    const labels = Object.entries(CATEGORIES).map(([, c]) => c.label);
    addBotMessage(
      "I want to make sure I point you the right way — which of these is closest to what you need?",
      { chips: labels, onChip: (label) => handleCategoryChoice(label) }
    );
  }

  function handleCategoryChoice(label) {
    const key = Object.keys(CATEGORIES).find((k) => CATEGORIES[k].label === label);
    addUserMessage(label);
    flow.categoryKey = key;
    flow.step = 0;
    flow.awaitingCategoryChoice = false;
    askCurrentQuestion();
  }

  function askCurrentQuestion() {
    const cat = CATEGORIES[flow.categoryKey];
    const q = cat.questions[flow.step];
    addBotMessage(q.text, { chips: q.chips, onChip: (label) => handleAnswer(label) });
  }

  function handleAnswer(label) {
    const cat = CATEGORIES[flow.categoryKey];
    const q = cat.questions[flow.step];
    addUserMessage(label);
    const value = q.map ? q.map[label] || label : label;
    flow.answers[q.key] = value;
    flow.step += 1;
    if (flow.step < cat.questions.length) {
      askCurrentQuestion();
    } else {
      finishFlow();
    }
  }

  function finishFlow() {
    const cat = CATEGORIES[flow.categoryKey];
    const typing = addTypingIndicator();
    // Swap this timeout+local call for `await askAI(flow.categoryKey, flow.originalPrompt, flow.answers)`
    // once a real backend/LLM endpoint is wired up (see file header).
    setTimeout(() => {
      typing.remove();
      const html = cat.finish(flow.answers);
      addBotMessage(html);
      flow = null;
    }, 900);
  }

  function handleFreeTextAnswer(text) {
    // Mid-flow free-typed answer (user typed instead of tapping a chip).
    const cat = CATEGORIES[flow.categoryKey];
    const q = cat.questions[flow.step];
    flow.answers[q.key] = text;
    flow.step += 1;
    if (flow.step < cat.questions.length) askCurrentQuestion();
    else finishFlow();
  }

  function handlePrompt(text) {
    if (!text.trim()) return;
    addUserMessage(text);

    if (flow && flow.awaitingCategoryChoice) {
      // User typed instead of tapping a category chip — try to match by keyword again.
      const key = detectCategory(text);
      if (key) {
        flow.categoryKey = key;
        flow.step = 0;
        flow.awaitingCategoryChoice = false;
        askCurrentQuestion();
      } else {
        addBotMessage("Still not sure which topic that is — please tap one of the options above.");
      }
      return;
    }

    if (flow && flow.categoryKey) {
      handleFreeTextAnswer(text);
      return;
    }

    const key = detectCategory(text);
    if (key) {
      flow = { categoryKey: key, answers: {}, step: 0, originalPrompt: text };
      askCurrentQuestion();
    } else {
      startCategoryChooser(text);
    }
  }

  function resetChat() {
    flow = null;
    log.innerHTML = "";
    addBotMessage(
      "New chat started. Ask me about crop diseases, what to grow, your soil, fertilizer, or pest control — or tap a topic on the left.",
    );
  }

  /* ------------------------------------------------------------------ */
  /* Composer wiring                                                     */
  /* ------------------------------------------------------------------ */

  if (composerForm) {
    composerForm.addEventListener("submit", (e) => {
      e.preventDefault();
      const text = composerInput.value.trim();
      if (!text) return;
      composerInput.value = "";
      composerInput.style.height = "auto";
      handlePrompt(text);
    });
    composerInput.addEventListener("input", () => {
      composerInput.style.height = "auto";
      composerInput.style.height = Math.min(composerInput.scrollHeight, 110) + "px";
    });
    composerInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        composerForm.requestSubmit();
      }
    });
  }

  $$(".ai-cat").forEach((btn) => {
    btn.addEventListener("click", () => {
      $$(".ai-cat").forEach((b) => b.classList.remove("is-active"));
      btn.classList.add("is-active");
      const key = btn.dataset.category;
      if (key === "map") {
        openMapModal();
        return;
      }
      flow = { categoryKey: key, answers: {}, step: 0, originalPrompt: "" };
      addUserMessage(CATEGORIES[key].label);
      askCurrentQuestion();
    });
  });

  const newChatBtn = $("#ai-new-chat");
  if (newChatBtn) newChatBtn.addEventListener("click", resetChat);

  /* ------------------------------------------------------------------ */
  /* Crop Plan Map                                                       */
  /* ------------------------------------------------------------------ */

  const mapOverlay = $("#map-overlay");
  const mapForm = $("#map-form");
  const mapResult = $("#map-result");
  let mapSelections = { soil: null, season: null, water: null };

  function openMapModal() {
    if (!mapOverlay) return;
    mapOverlay.classList.add("is-open");
    mapResult.hidden = true;
    mapForm.hidden = false;
    mapSelections = { soil: null, season: null, water: null };
    $$(".chip-select .ai-chip", mapForm).forEach((c) => c.classList.remove("is-selected"));
  }
  function closeMapModal() {
    mapOverlay && mapOverlay.classList.remove("is-open");
  }

  const mapCloseBtn = $("#map-close");
  if (mapCloseBtn) mapCloseBtn.addEventListener("click", closeMapModal);
  if (mapOverlay) mapOverlay.addEventListener("click", (e) => { if (e.target === mapOverlay) closeMapModal(); });

  $$(".chip-select", mapForm || document).forEach((group) => {
    group.addEventListener("click", (e) => {
      const chip = e.target.closest(".ai-chip");
      if (!chip) return;
      const field = group.dataset.field;
      $$(".ai-chip", group).forEach((c) => c.classList.remove("is-selected"));
      chip.classList.add("is-selected");
      mapSelections[field] = chip.dataset.value;
    });
  });

  if (mapForm) {
    mapForm.addEventListener("submit", (e) => {
      e.preventDefault();
      if (!mapSelections.soil || !mapSelections.season || !mapSelections.water) {
        showMapHint("Pick a soil type, season, and water availability to generate your plan.");
        return;
      }
      renderCropMap(mapSelections);
      mapForm.hidden = true;
      mapResult.hidden = false;
    });
  }

  function showMapHint(text) {
    let hint = $("#map-hint");
    if (!hint) {
      hint = document.createElement("p");
      hint.id = "map-hint";
      hint.style.cssText = "color:var(--rust);font-size:12.5px;margin:-8px 0 14px;";
      mapForm.insertBefore(hint, mapForm.querySelector('button[type="submit"]'));
    }
    hint.textContent = text;
  }

  function renderCropMap(selections) {
    const crops = recommendCrops(selections, 4);
    const totalPlots = 20;
    let plotsHtml = "";
    crops.forEach((c) => {
      const n = Math.max(1, Math.round((c.share / 100) * totalPlots));
      for (let i = 0; i < n; i++) {
        plotsHtml += `<div class="map-plot" style="background:${c.color}" title="${c.name}"></div>`;
      }
    });

    const legendHtml = crops
      .map(
        (c) => `
        <div class="map-legend__item">
          <span class="map-legend__swatch" style="background:${c.color}"></span>
          <div>
            <div class="map-legend__name">${c.name} <span class="map-legend__share">· ${c.share}% of field</span></div>
            <div class="map-legend__why">Matches your ${selections.soil} soil and ${selections.season} season conditions.</div>
          </div>
        </div>`
      )
      .join("");

    mapResult.innerHTML = `
      <div class="map-mosaic">${plotsHtml}</div>
      <div class="map-legend">${legendHtml}</div>
      <div class="map-rotation">🔄 Rotation tip: follow a cereal (rice/maize/wheat) with a legume (redgram/chickpea/soybean) next season — legumes fix nitrogen in the soil and help break pest cycles.</div>
      <button type="button" class="link-quiet" id="map-restart" style="margin-top:14px;">Start over</button>
    `;
    const restartBtn = $("#map-restart");
    if (restartBtn) restartBtn.addEventListener("click", openMapModal);
  }

  /* ------------------------------------------------------------------ */
  /* Welcome message                                                     */
  /* ------------------------------------------------------------------ */

  addBotMessage(
    "Hi! I'm the AgriLearn assistant. Ask me about crop diseases, what to grow, your soil, fertilizer, or pest control — I'll ask a couple of quick questions first so the answer actually fits your field.",
  );
})();
