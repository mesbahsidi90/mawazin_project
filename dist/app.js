import {defaultSettings,validateSettings,validateRecord,escapeHtml,dayKey,filterRecords,csvText} from './domain.js';
import {queueList,queueWrite,queueRemove} from './outbox.js';
(() => {
  "use strict";

  const STORAGE_KEY = "mizan-waste-records-v1";
  const DEFAULT_WEIGHT = 2.48;

  const FOODS = {
    rice: { label: "أرز", unitCost: 260, mark: "أر" },
    chicken: { label: "دجاج", unitCost: 620, mark: "دج" },
    bread: { label: "خبز", unitCost: 140, mark: "خب" },
    salad: { label: "سلطة", unitCost: 200, mark: "سل" },
    vegetables: { label: "خضر مطهوة", unitCost: 180, mark: "خض" },
    potatoes: { label: "بطاطا", unitCost: 120, mark: "بط" },
    soup: { label: "شوربة", unitCost: 150, mark: "شو" },
    dessert: { label: "حلويات", unitCost: 450, mark: "حل" }
  };

  const STAGES = {
    prep: { label: "أثناء التحضير", color: "#0d9488" },
    surplus: { label: "فائض الإنتاج", color: "#d97706" },
    buffet: { label: "نهاية الخدمة", color: "#2563eb" },
    plates: { label: "بقايا الأطباق", color: "#dc5b48" },
    storage: { label: "التخزين / التلف", color: "#94a3b8" }
  };

  const REASONS = {
    overproduction: { label: "إنتاج كمية أكبر من الطلب", avoidable: true },
    portion: { label: "حصة التقديم كبيرة", avoidable: true },
    spoilage: { label: "تلف أو انتهاء صلاحية", avoidable: true },
    prep_error: { label: "خطأ في التحضير", avoidable: true },
    quality: { label: "رفض بسبب الجودة", avoidable: true },
    unavoidable: { label: "جزء غير صالح للأكل", avoidable: false }
  };

  const MEALS = {
    breakfast: "فطور",
    lunch: "غداء",
    dinner: "عشاء"
  };

  const VIEW_META = {
    worker: { eyebrow: "محطة التسجيل 01", title: "تسجيل الهدر" },
    dashboard: { eyebrow: "الموقع: الجزائر الوسطى", title: "لوحة المدير" },
    simulator: { eyebrow: "وضع الاختبار", title: "محاكي الميزان" },
    reports: {eyebrow:'الفترة حسب توقيت الجزائر',title:'التقارير'},
    settings: {eyebrow:'المطبخ والحساب',title:'الإعدادات'}
  };

  const numberFormatter = new Intl.NumberFormat("ar-DZ", { maximumFractionDigits: 1 });
  const integerFormatter = new Intl.NumberFormat("ar-DZ", { maximumFractionDigits: 0 });
  const dateFormatter = new Intl.DateTimeFormat("ar-DZ", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit"
  });
  const timeFormatter = new Intl.DateTimeFormat("ar-DZ", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit"
  });

  const scale = {
    weight: DEFAULT_WEIGHT,
    connected: true,
    stable: true,
    displayWeight: DEFAULT_WEIGHT
  };

  let records = [];
  let account = null, demo = false, pending = [], syncing = false, submitting = false;
  let settings=structuredClone(defaultSettings), settingsRevision=0, lastSync=null;
  let reportPage=1, reportFiltered=[], inputMode='manual', manualWeight=0;
  let lastLoadError=false, authAttempt=0;
  let dashboardPeriod = 7;
  let toastTimer;
  let settleTimer;
  const events = [];

  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

  function makeId(prefix = "rec") {
    if (window.crypto && typeof window.crypto.randomUUID === "function") {
      return `${prefix}-${window.crypto.randomUUID()}`;
    }
    return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  }

  function atDayOffset(daysAgo, hour, minute = 0) {
    const date = new Date();
    date.setHours(hour, minute, 0, 0);
    date.setDate(date.getDate() - daysAgo);
    return date.toISOString();
  }

  function createRecord({ daysAgo, hour, minute, food, stage, reason, meal, weight }, index) {
    const unitCost = FOODS[food].unitCost;
    return {
      id: `demo-${daysAgo}-${index}`,
      timestamp: new Date(Math.min(Date.now(),new Date(atDayOffset(daysAgo, hour, minute)).getTime())).toISOString(),
      food,
      stage,
      reason,
      meal,
      weight: Number(weight.toFixed(3)),
      unitCost,
      cost: Math.round(weight * unitCost),
      source: "simulator"
    };
  }

  function seedRecords() {
    const recent = [
      [0, 13, 42, "rice", "buffet", "overproduction", "lunch", 8.4],
      [0, 13, 18, "chicken", "surplus", "overproduction", "lunch", 3.2],
      [0, 12, 56, "bread", "plates", "portion", "lunch", 2.1],
      [0, 11, 34, "salad", "prep", "unavoidable", "lunch", 1.4],
      [0, 8, 18, "dessert", "plates", "quality", "breakfast", 1.1],
      [1, 19, 35, "rice", "surplus", "overproduction", "dinner", 7.2],
      [1, 14, 5, "vegetables", "buffet", "overproduction", "lunch", 4.3],
      [1, 9, 12, "bread", "plates", "portion", "breakfast", 2.8],
      [2, 14, 16, "chicken", "plates", "portion", "lunch", 4.1],
      [2, 13, 52, "potatoes", "buffet", "overproduction", "lunch", 5.7],
      [3, 19, 20, "soup", "surplus", "overproduction", "dinner", 6.4],
      [3, 13, 29, "rice", "buffet", "overproduction", "lunch", 7.8],
      [4, 14, 3, "salad", "prep", "unavoidable", "lunch", 2.2],
      [4, 8, 42, "bread", "plates", "portion", "breakfast", 3.1],
      [5, 20, 8, "chicken", "storage", "spoilage", "dinner", 2.6],
      [5, 13, 11, "rice", "surplus", "overproduction", "lunch", 6.9],
      [6, 13, 48, "vegetables", "buffet", "quality", "lunch", 4.8],
      [6, 8, 7, "dessert", "plates", "portion", "breakfast", 1.7]
    ];

    const seeded = recent.map((row, index) => createRecord({
      daysAgo: row[0], hour: row[1], minute: row[2], food: row[3], stage: row[4],
      reason: row[5], meal: row[6], weight: row[7]
    }, index));

    const foodKeys = Object.keys(FOODS);
    const stageKeys = Object.keys(STAGES);
    const reasonKeys = ["overproduction", "portion", "unavoidable", "quality", "spoilage"];
    const mealKeys = Object.keys(MEALS);

    for (let day = 7; day < 61; day += 1) {
      const count = day % 4 === 0 ? 2 : 1;
      for (let i = 0; i < count; i += 1) {
        const food = foodKeys[(day + i * 3) % foodKeys.length];
        const stage = stageKeys[(day * 2 + i) % stageKeys.length];
        const reason = reasonKeys[(day + i) % reasonKeys.length];
        const meal = mealKeys[(day + i) % mealKeys.length];
        const weight = 1.3 + ((day * 13 + i * 17) % 52) / 10;
        seeded.push(createRecord({
          daysAgo: day,
          hour: meal === "breakfast" ? 8 : meal === "lunch" ? 13 : 19,
          minute: (day * 7 + i * 11) % 58,
          food,
          stage,
          reason,
          meal,
          weight
        }, seeded.length));
      }
    }

    return seeded.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
  }

  function loadRecords() {
    try {
    const stored = JSON.parse(localStorage.getItem('mawazin-demo-v2'));
      if (Array.isArray(stored)) return stored.map(row=>validateRecord(row));
    } catch (error) {
      console.warn("تعذر تحميل البيانات المحلية", error);
    }
    const seeded = seedRecords();
    try {
      localStorage.setItem('mawazin-demo-v2', JSON.stringify(seeded));
    } catch (error) {
      console.warn("تعذر حفظ البيانات التجريبية", error);
    }
    return seeded;
  }

  function saveRecords() {
    try {
      localStorage.setItem('mawazin-demo-v2', JSON.stringify(records));
      return true;
    } catch (error) {
      showToast("تعذر الحفظ", "مساحة التخزين المحلية غير متاحة في هذا المتصفح.", true);
      return false;
    }
  }

  function populateSelect(select, data) {
    select.innerHTML = Object.entries(data)
      .map(([value, item]) => `<option value="${value}">${item.label}</option>`)
      .join("");
  }

  function initializeForm() {
    $("#foodPicker").innerHTML = Object.entries(FOODS).map(([value, food], index) => `
      <label class="food-option">
        <input type="radio" name="food" value="${value}" required ${index === 0 ? 'checked' : ''} />
        <span class="food-card">
          <span class="food-photo" aria-hidden="true" style="background-position:${(index % 4) * 100 / 3}% ${Math.floor(index / 4) * 100}%"></span>
          <span class="food-name">${food.label}</span>
          <span class="food-check" aria-hidden="true">✓</span>
        </span>
      </label>`).join('');
    populateSelect($("#stageSelect"), STAGES);
    populateSelect($("#reasonSelect"), REASONS);
    $("#stageSelect").value = "buffet";
    $("#reasonSelect").value = "overproduction";
  }

  function switchView(name) {
    if (!VIEW_META[name] || (!account && !demo)) return;

    $$(".view").forEach((view) => {
      const active = view.dataset.view === name;
      view.hidden = !active;
      view.classList.toggle("active", active);
    });
    $$('[data-view-target]').forEach((button) => {
      button.classList.toggle("active", button.dataset.viewTarget === name);
    });
    $("#viewEyebrow").textContent = VIEW_META[name].eyebrow;
    $("#viewTitle").textContent = VIEW_META[name].title;

    if (name === "dashboard") renderDashboard();
    if (name === "simulator") renderSimulator();
    if (name === 'reports') renderReport();
    if (name === 'settings') renderSettings();
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function displayReading() {
    if (!scale.connected) return "---.---";
    return scale.displayWeight.toFixed(3);
  }

  function renderScale() {
    const weightText = displayReading();
    $("#liveWeight").textContent = weightText;
    $("#simWeight").textContent = weightText;
    $("#rangeValue").textContent = `${scale.weight.toFixed(3)} كغ`;
    $("#weightRange").value = String(scale.weight);
    const percentage = Math.min(100, Math.max(0, (scale.weight / 20) * 100));
    $("#weightRange").style.background = `linear-gradient(to left, #0d9488 ${percentage}%, #d8e0df ${percentage}%)`;

    const statusText = !scale.connected ? "لا توجد إشارة" : scale.stable ? "قراءة مستقرة" : "القراءة تتحرك";
    $("#weightStatus").textContent = statusText;
    $("#simStateLabel").textContent = !scale.connected ? "OFFLINE" : scale.stable ? "STABLE" : "MOVING";

    [$("#workerScaleVisual"), $("#simDevice")].forEach((element) => {
      element.classList.toggle("unstable", scale.connected && !scale.stable);
      element.classList.toggle("offline", !scale.connected);
    });

    const workerPill = $("#workerConnection");
    const simulatorPill = $("#simConnectionPill");
    [workerPill, simulatorPill].forEach((pill) => {
      pill.classList.toggle("online", scale.connected);
      pill.classList.toggle("offline", !scale.connected);
      pill.innerHTML = `<span class="pulse-dot" aria-hidden="true"></span>${scale.connected ? "متصل" : "غير متصل"}`;
    });

    $("#connectionToggle").classList.toggle("active", scale.connected);
    $("#connectionToggle").setAttribute("aria-checked", String(scale.connected));
    $("#stabilityToggle").classList.toggle("active", scale.stable);
    $("#stabilityToggle").setAttribute("aria-checked", String(scale.stable));
    $("#foodLoad").classList.toggle("empty", scale.weight < 0.02);
    $("#sendToWorkerButton").disabled = !scale.connected || scale.weight < 0.02;

    updateCostPreview();
  }

  function updateCostPreview() {
    const food = FOODS[$("#foodPicker").querySelector('input:checked')?.value] || FOODS.rice;
    const weight = inputMode==='manual'?manualWeight:(scale.connected ? scale.weight : 0);
    $("#previewWeight").textContent = `${weight.toFixed(3)} كغ`;
    $("#previewCost").textContent = `${integerFormatter.format(Math.round(weight * food.unitCost))} دج`;

    const canRecord = !submitting && (account || demo) && weight>=0.02 && weight<=20 && (inputMode==='manual'||(scale.connected && scale.stable));
    $("#recordButton").disabled = !canRecord;
    $("#recordHint").textContent = inputMode==='manual' ? 'أدخل الوزن الصافي من ميزانك. لن يُرسل السجل دون تأكيدك.' : !scale.connected
      ? "أعد اتصال الميزان من شاشة المحاكي قبل التسجيل."
      : !scale.stable
        ? "انتظر حتى تصبح القراءة مستقرة."
        : scale.weight < 0.02
          ? "ضع الحمولة على الميزان أو استخدم المحاكي."
          : "اختر الصنف والسبب، ثم أكد القراءة المستقرة.";
  }

  function setWeight(value, options = {}) {
    const next = Math.min(20, Math.max(0, Number(value) || 0));
    scale.weight = Number(next.toFixed(3));
    scale.displayWeight = scale.weight;
    renderScale();

    if (options.settle) {
      clearTimeout(settleTimer);
      scale.stable = false;
      renderScale();
      settleTimer = setTimeout(() => {
        scale.stable = true;
        scale.displayWeight = scale.weight;
        renderScale();
        addEvent("قراءة مستقرة", `${scale.weight.toFixed(3)} كغ جاهزة للتسجيل`);
      }, 620);
    }
  }

  function showToast(title, message, isError = false) {
    clearTimeout(toastTimer);
    $("#toastTitle").textContent = title;
    $("#toastText").textContent = message;
    $("#toast").classList.toggle("error", isError);
    $("#toast").classList.add("show");
    toastTimer = setTimeout(() => $("#toast").classList.remove("show"), 3600);
  }

  function addEvent(title, detail, type = "normal") {
    events.unshift({ id: makeId("event"), title, detail, type, at: new Date() });
    if (events.length > 8) events.length = 8;
    renderEvents();
  }

  function renderEvents() {
    $("#eventLog").innerHTML = events.map((event) => `
      <div class="event-item ${event.type}">
        <span class="event-dot" aria-hidden="true"></span>
        <div><strong>${event.title}</strong><span>${event.detail}</span></div>
        <time>${timeFormatter.format(event.at)}</time>
      </div>
    `).join("");
  }

  async function handleRecord(event) {
    event.preventDefault();
    if (submitting || (!account && !demo)) return;
    if (inputMode!=='manual' && !scale.connected) {
      showToast("الميزان غير متصل", "فعّل الاتصال من شاشة المحاكي ثم حاول مجددًا.", true);
      return;
    }
    if (inputMode!=='manual' && !scale.stable) {
      showToast("القراءة غير مستقرة", "انتظر لحظة حتى تثبت الحمولة.", true);
      return;
    }
    const chosenWeight=inputMode==='manual'?manualWeight:scale.weight;
    if (!Number.isFinite(chosenWeight) || chosenWeight < 0.02 || chosenWeight>20) {
      showToast("لا توجد حمولة", "ضع الهدر على الميزان قبل التسجيل.", true);
      return;
    }

    const food = $("#foodPicker").querySelector('input:checked').value;
    const stage = $("#stageSelect").value;
    const reason = $("#reasonSelect").value;
    const meal = $('input[name="meal"]:checked').value;
    const weight = chosenWeight;
    const unitCost = FOODS[food].unitCost;
    const record = {
      id: makeId(),
      timestamp: new Date().toISOString(),
      food,
      stage,
      reason,
      meal,
      weight,
      unitCost,
      cost: Math.round(weight * unitCost),
      source: inputMode,
      note: $('#recordNote').value.trim()
    };

    submitting=true;updateCostPreview();
    try {
      if(demo) {
        records.unshift(record);
        if(!saveRecords()){records.shift();return;}
      } else {
        await queueWrite(account.id,record);
        pending=await queueList(account.id);
        mergeRecords(records,pending);
      }
      setWeight(0);manualWeight=0;$('#manualWeight').value='';$('#recordNote').value='';
      renderWorkerRecent();renderDashboard();renderNetwork();
      addEvent('حفظ التسجيل',`${FOODS[food].label} — ${weight.toFixed(3)} كغ`);
      showToast(demo?'حُفظ في التجربة':'حُفظ في قائمة الإرسال',demo?'هذه بيانات محلية تجريبية.':'ستظهر حالة التأكيد بعد المزامنة.');
      if(!demo) void synchronize();
    } catch {showToast('لم يُحفظ التسجيل','تعذر التخزين على الجهاز. بقي الإدخال كما هو؛ أعد المحاولة.',true);}
    finally {submitting=false;updateCostPreview();}
  }

  function formatRecordTime(timestamp) {
    const date = new Date(timestamp);
    const now = new Date();
    const sameDay = date.toDateString() === now.toDateString();
    return sameDay
      ? new Intl.DateTimeFormat("ar-DZ", { hour: "2-digit", minute: "2-digit" }).format(date)
      : dateFormatter.format(date);
  }

  function renderWorkerRecent() {
    const latest = [...records]
      .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))
      .slice(0, 4);

    $("#workerRecentList").innerHTML = latest.map((record) => `
      <div class="recent-item">
        <span class="food-icon">${FOODS[record.food]?.mark || "--"}</span>
        <div class="recent-item-info">
          <strong>${FOODS[record.food]?.label || record.food}</strong>
          <small>${formatRecordTime(record.timestamp)} · ${MEALS[record.meal] || record.meal}</small>
        </div>
        <span class="recent-weight">${Number(record.weight).toFixed(2)} كغ</span>
      </div>
    `).join("");
    if(!latest.length) $('#workerRecentList').innerHTML='<p class="empty-state">لا توجد تسجيلات بعد. ابدأ بوزن يدوي أو افتح المحاكي.</p>';
  }

  function periodBounds(period, previous = false) {
    const end = new Date();
    end.setHours(0, 0, 0, 0);
    end.setDate(end.getDate() + (previous ? -(period - 1) : 1));
    const start = new Date(end);
    start.setDate(start.getDate() - period);
    return { start, end };
  }

  function recordsWithin(period, previous = false) {
    const today=dayKey(new Date());
    const end=new Date(today+'T00:00:00+01:00');
    if(previous) end.setUTCDate(end.getUTCDate()-period);
    const start=new Date(end);start.setUTCDate(start.getUTCDate()-(period-1));
    return filterRecords(records,{start:dayKey(start),end:dayKey(end),source:demo?'':'manual'});
  }

  function sum(list, getter) {
    return list.reduce((total, item) => total + getter(item), 0);
  }

  function renderKpis(filtered) {
    const totalWeight = sum(filtered, (record) => Number(record.weight));
    const totalCost = sum(filtered, (record) => Number(record.cost));
    const avoidableWeight = sum(filtered.filter((record) => REASONS[record.reason]?.avoidable), (record) => Number(record.weight));
    const avoidableShare = totalWeight ? (avoidableWeight / totalWeight) * 100 : 0;
    const previousWeight = sum(recordsWithin(dashboardPeriod, true), (record) => Number(record.weight));
    const change = previousWeight ? ((totalWeight - previousWeight) / previousWeight) * 100 : 0;

    $("#kpiWeight").textContent = numberFormatter.format(totalWeight);
    $("#kpiCost").textContent = integerFormatter.format(Math.round(totalCost));
    $("#kpiAvoidable").textContent = integerFormatter.format(Math.round(avoidableShare));
    $("#kpiEntries").textContent = integerFormatter.format(filtered.length);
    $("#donutTotal").textContent = numberFormatter.format(totalWeight);

    const trend = $("#wasteTrend");
    const isReduction = change <= 0;
    trend.textContent = `${isReduction ? "−" : "+"}${integerFormatter.format(Math.abs(Math.round(change)))}%`;
    if(!previousWeight) trend.textContent='—';
    trend.classList.toggle("positive", isReduction);
    trend.classList.toggle("negative", !isReduction);
    $("#kpiWeightNote").textContent = isReduction ? "أقل من الفترة السابقة" : "أعلى من الفترة السابقة";
    if(!previousWeight) $('#kpiWeightNote').textContent='لا توجد مقارنة سابقة';
    $("#kpiAvoidableNote").textContent = `${numberFormatter.format(avoidableWeight)} كغ قابلة للتدخل`;
    $("#kpiEntriesNote").textContent = dashboardPeriod === 1 ? "منذ بداية اليوم" : `خلال آخر ${dashboardPeriod} أيام`;
  }

  function createChartBuckets(period) {
    const start = new Date(dayKey(new Date())+'T00:00:00+01:00');
    start.setUTCDate(start.getUTCDate()-(period-1));
    const bucketDays = period > 10 ? 3 : 1;
    const buckets = [];
    for (let offset = 0; offset < period; offset += bucketDays) {
      const bucketStart = new Date(start);
      bucketStart.setUTCDate(bucketStart.getUTCDate() + offset);
      const bucketEnd = new Date(bucketStart);
      bucketEnd.setUTCDate(bucketEnd.getUTCDate() + Math.min(bucketDays, period - offset));
      const weight = sum(records.filter((record) => {
        const time = new Date(record.timestamp);
        return time >= bucketStart && time < bucketEnd && (demo || record.source==='manual');
      }), (record) => Number(record.weight));
      const label = period === 1
        ? "اليوم"
        : period <= 7
          ? new Intl.DateTimeFormat("ar-DZ", { weekday: "short" }).format(bucketStart)
          : new Intl.DateTimeFormat("ar-DZ", { day: "numeric", month: "numeric" }).format(bucketStart);
      buckets.push({ label, weight });
    }
    return buckets;
  }

  function renderDailyChart() {
    const buckets = createChartBuckets(dashboardPeriod);
    const maximum = Math.max(...buckets.map((bucket) => bucket.weight), 1);
    $("#dailyChart").innerHTML = buckets.map((bucket) => {
      const height = Math.max(bucket.weight ? 7 : 3, (bucket.weight / maximum) * 137);
      return `
        <div class="bar-column" title="${bucket.label}: ${numberFormatter.format(bucket.weight)} كغ">
          <span class="bar-value">${numberFormatter.format(bucket.weight)}</span>
          <div class="bar-track"><div class="bar-fill" style="height:${height}px"></div></div>
          <span class="bar-day">${bucket.label}</span>
        </div>
      `;
    }).join("");
  }

  function groupWeights(filtered, property) {
    return filtered.reduce((groups, record) => {
      const key = record[property];
      groups[key] = (groups[key] || 0) + Number(record.weight);
      return groups;
    }, {});
  }

  function renderPareto(filtered) {
    const groups = groupWeights(filtered, "food");
    const ranked = Object.entries(groups).sort((a, b) => b[1] - a[1]).slice(0, 5);
    const maximum = ranked[0]?.[1] || 1;
    $("#paretoList").innerHTML = ranked.map(([key, weight]) => `
      <div class="pareto-item">
        <span class="pareto-label">${FOODS[key]?.label || key}</span>
        <div class="pareto-track"><div class="pareto-fill" style="width:${(weight / maximum) * 100}%"></div></div>
        <span class="pareto-value">${numberFormatter.format(weight)} كغ</span>
      </div>
    `).join("");
  }

  function renderStages(filtered) {
    const groups = groupWeights(filtered, "stage");
    const ranked = Object.entries(groups).sort((a, b) => b[1] - a[1]);
    const total = sum(ranked, (entry) => entry[1]);
    let cursor = 0;
    const gradient = ranked.map(([key, weight]) => {
      const start = cursor;
      cursor += total ? (weight / total) * 100 : 0;
      return `${STAGES[key]?.color || "#94a3b8"} ${start}% ${cursor}%`;
    });
    $("#stageDonut").style.background = gradient.length
      ? `conic-gradient(${gradient.join(",")})`
      : "#d8e0df";
    $("#stageLegend").innerHTML = ranked.slice(0, 5).map(([key, weight]) => `
      <div class="stage-row">
        <span class="dot" style="background:${STAGES[key]?.color || "#94a3b8"}"></span>
        <span>${STAGES[key]?.label || key}</span>
        <strong>${total ? integerFormatter.format(Math.round((weight / total) * 100)) : 0}%</strong>
      </div>
    `).join("");
  }

  function renderInsight(filtered) {
    const foodGroups = groupWeights(filtered, "food");
    const stageGroups = groupWeights(filtered, "stage");
    const topFood = Object.entries(foodGroups).sort((a, b) => b[1] - a[1])[0];
    const topStage = Object.entries(stageGroups).sort((a, b) => b[1] - a[1])[0];
    const avoidable = filtered.filter((record) => REASONS[record.reason]?.avoidable);
    const avoidableCost = sum(avoidable, (record) => Number(record.cost));
    const potential = Math.round(avoidableCost * 0.25);

    if (!topFood) {
      $("#insightTitle").textContent = "ابدأ بتسجيل الهدر لاكتشاف أول فرصة للتحسين.";
      $("#insightText").textContent = "ستظهر التوصية عندما تتوفر سجلات ضمن الفترة المحددة.";
      $("#savingPotential").textContent = "0 دج";
      return;
    }

    const foodLabel = FOODS[topFood[0]]?.label || topFood[0];
    const stageLabel = STAGES[topStage?.[0]]?.label || "مرحلة الخدمة";
    $("#insightTag").textContent = `${foodLabel} · ${numberFormatter.format(topFood[1])} كغ`;
    $("#insightTitle").textContent = `راجع أسباب هدر ${foodLabel} أولًا.`;
    $("#insightText").textContent = `أعلى مرحلة هدر إجمالًا: «${stageLabel}». هذه ملاحظة حسابية وليست توقعًا بالذكاء الاصطناعي؛ لا تكفي أوزان الهدر وحدها لتحديد كمية التحضير القادمة.`;
    $("#savingPotential").textContent = `${integerFormatter.format(potential)} دج`;
  }

  function renderTable(filtered) {
    const latest = [...filtered]
      .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))
      .slice(0, 10);
    $("#tableCount").textContent = `${integerFormatter.format(filtered.length)} سجل`;
    $("#recordsTable").innerHTML = latest.map((record) => `
      <tr>
        <td>${formatRecordTime(record.timestamp)}</td>
        <td><strong>${FOODS[record.food]?.label || record.food}</strong></td>
        <td>${STAGES[record.stage]?.label || record.stage}</td>
        <td><span class="avoidability-dot" style="background:${REASONS[record.reason]?.avoidable ? "#d97706" : "#94a3b8"}"></span>${REASONS[record.reason]?.label || record.reason}</td>
        <td class="weight-cell">${Number(record.weight).toFixed(2)} كغ</td>
        <td class="cost-cell">${integerFormatter.format(record.cost)} دج</td>
      </tr>
    `).join("");
    if(!latest.length) $('#recordsTable').innerHTML='<tr><td colspan="6" class="empty-state">لا توجد قياسات يدوية ضمن الفترة. سجلات المحاكي تظهر في التقارير عند اختيار مصدر المحاكي.</td></tr>';
  }

  function renderDashboard() {
    const filtered = recordsWithin(dashboardPeriod);
    renderKpis(filtered);
    renderDailyChart();
    renderPareto(filtered);
    renderStages(filtered);
    renderInsight(filtered);
    renderTable(filtered);
    const todayWeight=sum(recordsWithin(1),r=>r.weight);
    $('#dataScope').textContent=(demo?'وضع تجريبي محلي — يتضمن بيانات محاكية.':'سجلات هذا الحساب فقط. المؤشرات تستبعد المحاكي؛ المعلق تقديري.')+(todayWeight>settings.dailyTarget?` تنبيه: هدر اليوم ${numberFormatter.format(todayWeight)} كغ تجاوز الحد ${settings.dailyTarget} كغ.`:'');
  }

  function renderSimulator() {
    renderScale();
    renderEvents();
  }

  function exportCsv() {
    const filtered = recordsWithin(dashboardPeriod);
    const rows = [
      ["التاريخ", "الوجبة", "الصنف", "المرحلة", "السبب", "الوزن كغ", "التكلفة دج"],
      ...filtered.map((record) => [
        new Date(record.timestamp).toLocaleString("ar-DZ"),
        MEALS[record.meal] || record.meal,
        FOODS[record.food]?.label || record.food,
        STAGES[record.stage]?.label || record.stage,
        REASONS[record.reason]?.label || record.reason,
        Number(record.weight).toFixed(3),
        record.cost
      ])
    ];
    const csv = rows.map((row) => row.map((cell) => `"${String(cell).replaceAll('"', '""')}"`).join(",")).join("\n");
    const blob = new Blob(["\ufeff", csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `mizan-waste-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
    showToast("تم تجهيز التقرير", `تم تصدير ${filtered.length} سجلًا بصيغة CSV.`);
  }

  function resetDemoData() {
    if(!demo) return;
    const confirmed = window.confirm("سيتم حذف التسجيلات المحلية وإعادة البيانات التجريبية. هل تريد المتابعة؟");
    if (!confirmed) return;
    records = seedRecords();
    saveRecords();
    renderWorkerRecent();
    renderDashboard();
    setWeight(DEFAULT_WEIGHT);
    addEvent("استعادة البيانات", "تمت إعادة النموذج إلى حالته التجريبية");
    showToast("تمت الاستعادة", "أعيدت البيانات والقراءة التجريبية بنجاح.");
  }

  function bindEvents() {
    $$('[data-view-target]').forEach((button) => {
      button.addEventListener("click", () => switchView(button.dataset.viewTarget));
    });

    $("#foodPicker").addEventListener("change", updateCostPreview);
    $("#wasteForm").addEventListener("submit", handleRecord);
    $("#tareButton").addEventListener("click", () => {
      setWeight(0);
      addEvent("تصفير الميزان", "أصبحت القراءة 0.000 كغ");
      showToast("تم تصفير الميزان", "الميزان جاهز لحمولة جديدة.");
    });

    $("#weightRange").addEventListener("input", (event) => setWeight(event.target.value));
    $("#weightRange").addEventListener("change", (event) => {
      setWeight(event.target.value, { settle: true });
      addEvent("تغيرت الحمولة", `الهدف ${Number(event.target.value).toFixed(3)} كغ`, "warning");
    });

    $$('[data-add-weight]').forEach((button) => {
      button.addEventListener("click", () => {
        setWeight(scale.weight + Number(button.dataset.addWeight), { settle: true });
        addEvent("أضيفت حمولة", `+${Number(button.dataset.addWeight).toFixed(2)} كغ`, "warning");
      });
    });
    $$('[data-set-weight]').forEach((button) => {
      button.addEventListener("click", () => {
        setWeight(Number(button.dataset.setWeight));
        addEvent("أزيلت الحمولة", "عادت القراءة إلى الصفر");
      });
    });

    $("#connectionToggle").addEventListener("click", () => {
      scale.connected = !scale.connected;
      scale.displayWeight = scale.weight;
      renderScale();
      addEvent(
        scale.connected ? "اتصال الجهاز" : "انقطاع الاتصال",
        scale.connected ? "تمت استعادة تدفق القراءات" : "توقفت البيانات من الميزان",
        scale.connected ? "normal" : "error"
      );
    });

    $("#stabilityToggle").addEventListener("click", () => {
      scale.stable = !scale.stable;
      scale.displayWeight = scale.weight;
      renderScale();
      addEvent(
        scale.stable ? "قراءة مستقرة" : "اهتزاز الحمولة",
        scale.stable ? `${scale.weight.toFixed(3)} كغ جاهزة للتسجيل` : "القيمة تتغير مؤقتًا",
        scale.stable ? "normal" : "warning"
      );
    });

    $("#sendToWorkerButton").addEventListener("click", () => {
      if (!scale.connected || scale.weight < 0.02) return;
      scale.stable = true;
      scale.displayWeight = scale.weight;
      renderScale();
      $('#inputMode').value='simulator';setInputMode();
      addEvent("إرسال القراءة", `${scale.weight.toFixed(3)} كغ إلى تطبيق العامل`);
      switchView("worker");
      showToast("وصلت القراءة", `${scale.weight.toFixed(3)} كغ جاهزة للتصنيف والتسجيل.`);
    });

    $$("[data-period]").forEach((button) => {
      button.addEventListener("click", () => {
        dashboardPeriod = Number(button.dataset.period);
        $$("[data-period]").forEach((item) => item.classList.toggle("active", item === button));
        renderDashboard();
      });
    });

    $("#exportButton").addEventListener("click", exportCsv);
    $("#resetDemoButton").addEventListener("click", resetDemoData);
  }

  function updateClock() {
    $("#clock").textContent = timeFormatter.format(new Date());
  }

  async function api(path, options={}) {
    const response=await fetch(path,{...options,credentials:'same-origin',cache:'no-store',headers:{'Content-Type':'application/json',...options.headers},signal:AbortSignal.timeout(12000)});
    if(!response.headers.get('content-type')?.includes('application/json')) throw new Error('الخادم المركزي غير مفعّل في هذه النسخة.');
    const result=await response.json();
    if(!response.ok) {
      const error=new Error(result.error||'تعذر إتمام الطلب');error.status=response.status;throw error;
    }
    return result;
  }
  function mergeRecords(serverRows,queued) {
    const merged=new Map(serverRows.map(r=>[r.id,r]));
    for(const r of queued) if(!merged.has(r.id)) merged.set(r.id,r);
    records=[...merged.values()].sort((a,b)=>b.timestamp.localeCompare(a.timestamp));
  }
  function renderNetwork() {
    $('#networkLabel').textContent=navigator.onLine?'الشبكة متاحة للجهاز (لا تؤكد اتصال الخادم)':'لا يوجد اتصال بالشبكة';
    $('#syncLabel').textContent=demo?'وضع محلي — لا مزامنة سحابية':syncing?'جارٍ إرسال التسجيلات…':`${pending.length} معلّق${lastLoadError?' · تعذر الاتصال بالخادم':lastSync?' · آخر نجاح '+formatRecordTime(lastSync):' · لم تتم المزامنة'}`;
    $('#syncButton').disabled=demo||syncing||!account||!navigator.onLine;
    $('#lastSync').textContent=lastSync?dateFormatter.format(new Date(lastSync)):'لم تتم بعد';
  }
  async function synchronize() {
    if(demo||!account||syncing||!navigator.onLine) {renderNetwork();return;}
    const owner=account.id;
    syncing=true;renderNetwork();
    try {
      const session=await api('/api/session');
      if(session.user.id!==owner) throw new Error('تغير الحساب. سجّل الخروج وادخل بالحساب الصحيح.');
      const queued=await queueList(owner);
      for(const record of queued) {
        if(account?.id!==owner) return;
        const result=await api('/api/records',{method:'POST',body:JSON.stringify(record)});
        await queueRemove(owner,record.id);
        records=records.map(r=>r.id===record.id?result.record:r);
      }
      const fresh=[];let cursor=0;
      do {
        const result=await api('/api/records?cursor='+cursor);
        fresh.push(...result.records);cursor=result.nextCursor;
      } while(cursor!==null);
      if(account?.id!==owner) return;
      pending=await queueList(owner);mergeRecords(fresh,pending);
      lastSync=new Date().toISOString();lastLoadError=false;
    } catch(error) {
      lastLoadError=true;
      if(account?.id===owner) {
        pending=await queueList(owner).catch(()=>pending);
        showToast('المزامنة غير مكتملة',error.message+' التسجيلات المعلقة لم تُحذف.',true);
      }
    } finally {
      syncing=false;renderNetwork();renderWorkerRecent();renderDashboard();
      if(!$('#reportsView').hidden) renderReport();
    }
  }
  async function startAccount() {
    const attempt=++authAttempt;
    $('#resumeSession').disabled=true;
    $('#loginStatus').textContent='جارٍ التحقق من الحساب والتخزين…';
    try {
      const session=await api('/api/session');
      if(!session.user?.id) throw new Error('استجابة حساب غير صالحة');
      const loaded=await api('/api/settings');
      const queued=await queueList(session.user.id);
      if(attempt!==authAttempt) return;
      account=session.user;demo=false;settings=loaded.settings;settingsRevision=loaded.revision;
      records=[];pending=queued;mergeRecords([],queued);lastSync=null;
      enterApplication();await synchronize();
    } catch(error) {
      if(attempt===authAttempt) $('#loginStatus').textContent=error.status===401?'سجّل الدخول للمتابعة.':error.message+' يمكنك فتح وضع التجربة.';
    } finally {$('#resumeSession').disabled=false;}
  }
  function enterApplication() {
    $('#loginPanel').hidden=true;$('#appShell').hidden=false;
    $('#accountLabel').textContent=demo?'حساب تجريبي':account.email||'الحساب الحالي';
    $('#storageLabel').textContent=demo?'محلي على هذا الجهاز':'تخزين مركزي / مساحة شخصية';
    $('#systemStorage').textContent=demo?'تجريبي محلي، لا يُرسل للخادم':'D1 مركزي، مع قائمة إرسال مؤقتة على الجهاز';
    $('#resetDemoButton').hidden=!demo;
    $('#reportSource').value=demo?'':'manual';
    applySettings();setInputMode();renderWorkerRecent();renderDashboard();renderNetwork();
    switchView('worker');
  }
  function logout() {
    if(syncing||submitting) {showToast('انتظر إتمام العملية','يمكنك تسجيل الخروج بعد انتهاء محاولة الحفظ.',true);return;}
    if(pending.length&&!window.confirm(`يوجد ${pending.length} سجلًا معلقًا سيبقى على هذا الجهاز للحساب نفسه. تسجيل الخروج؟`)) return;
    const wasDemo=demo;
    authAttempt++;
    account=null;demo=false;records=[];pending=[];lastSync=null;settings=structuredClone(defaultSettings);
    $('#appShell').hidden=true;$('#loginPanel').hidden=false;
    $('#loginStatus').textContent='تم إغلاق الجلسة.';
    if(!wasDemo) window.location.assign('/signout-with-chatgpt?return_to=%2F');
  }
  function setInputMode() {
    inputMode=$('#inputMode').value;
    $('#manualField').hidden=inputMode!=='manual';
    $('#workerScaleVisual').hidden=inputMode==='manual';
    $('#workerConnection').hidden=inputMode==='manual';
    $('#tareButton').hidden=inputMode==='manual';
    updateCostPreview();
  }
  function applySettings() {
    for(const [key,value] of Object.entries(settings.unitPrices)) FOODS[key].unitCost=value;
    $('#siteNameLabel').textContent=settings.siteName;
    updateCostPreview();
  }
  function renderSettings() {
    $('#settingName').value=settings.siteName;$('#settingTarget').value=settings.dailyTarget;
    $('#priceInputs').innerHTML=Object.keys(FOODS).map(key=>`<label class="input-label"><span>${FOODS[key].label}</span><input data-price="${key}" aria-label="سعر ${FOODS[key].label}" type="number" min="0" max="1000000" step="1" required value="${settings.unitPrices[key]}" /></label>`).join('');
    renderNetwork();
  }
  async function saveSettings(event) {
    event.preventDefault();$('#settingsSave').disabled=true;
    try {
      const next=validateSettings({siteName:$('#settingName').value,dailyTarget:Number($('#settingTarget').value),unitPrices:Object.fromEntries($$('[data-price]').map(el=>[el.dataset.price,Number(el.value)]))});
      if(demo) {localStorage.setItem('mawazin-demo-settings-v2',JSON.stringify(next));settings=next;}
      else {
        const result=await api('/api/settings',{method:'PUT',body:JSON.stringify({settings:next,revision:settingsRevision})});
        settings=result.settings;settingsRevision=result.revision;
      }
      applySettings();renderDashboard();$('#settingsStatus').textContent=demo?'حُفظت إعدادات التجربة محليًا.':'حُفظت الإعدادات مركزيًا.';
    } catch(error) {$('#settingsStatus').textContent=error.message+' لم يتم الحفظ؛ احتفظنا بالمدخلات.';}
    finally {$('#settingsSave').disabled=false;}
  }
  function reportFilters() {
    const start=$('#reportStart').value,end=$('#reportEnd').value;
    if(!start||!end||start>end) throw new Error('اختر فترة صحيحة؛ البداية لا تتجاوز النهاية.');
    return {start,end,food:$('#reportFood').value,stage:$('#reportStage').value,source:$('#reportSource').value};
  }
  function renderReport() {
    try {
      const filters=reportFilters();$('#reportError').textContent='';
      reportFiltered=filterRecords(records,filters).sort((a,b)=>b.timestamp.localeCompare(a.timestamp));
      const total=reportFiltered.reduce((s,r)=>({weight:s.weight+r.weight,cost:s.cost+r.cost}),{weight:0,cost:0});
      $('#reportSummary').textContent=`${settings.siteName} | ${filters.start} — ${filters.end} | ${reportFiltered.length} سجل | ${numberFormatter.format(total.weight)} كغ | ${integerFormatter.format(total.cost)} دج`;
      const pages=Math.max(1,Math.ceil(reportFiltered.length/25));reportPage=Math.min(reportPage,pages);
      $('#reportRows').innerHTML=rowsHtml(reportFiltered.slice((reportPage-1)*25,reportPage*25));
      $('#reportPage').textContent=`${reportPage} / ${pages}`;
      $('#reportPrev').disabled=reportPage<=1;$('#reportNext').disabled=reportPage>=pages;
    } catch(error) {
      reportFiltered=[];$('#reportRows').innerHTML='';$('#reportSummary').textContent='';$('#reportError').textContent=error.message;
    }
  }
  function rowsHtml(rows) {
    if(!rows.length) return '<tr><td colspan="8" class="empty-state">لا توجد سجلات مطابقة. غيّر الفترة أو المصدر أو أضف تسجيلًا.</td></tr>';
    const pendingIds=new Set(pending.map(r=>r.id));
    return rows.map(r=>`<tr><td>${escapeHtml(dateFormatter.format(new Date(r.timestamp)))}</td><td>${FOODS[r.food].label}</td><td>${STAGES[r.stage].label}</td><td>${REASONS[r.reason].label}</td><td>${r.weight.toFixed(3)}</td><td>${r.cost}</td><td>${r.source==='manual'?'يدوي':'محاكي'} / ${demo?'تجريبي':pendingIds.has(r.id)?'معلق':'مؤكد'}</td><td class="note-cell">${escapeHtml(r.note)}</td></tr>`).join('');
  }
  function download(name,content,type) {
    const url=URL.createObjectURL(new Blob([content],{type}));
    const link=document.createElement('a');link.href=url;link.download=name;document.body.append(link);link.click();link.remove();
    setTimeout(()=>URL.revokeObjectURL(url),1000);
  }
  function exportReport() {
    renderReport();if($('#reportError').textContent) return;
    const pendingIds=new Set(pending.map(r=>r.id));
    download('mawazin-report-'+dayKey(new Date())+'.csv',csvText([
      ['التاريخ بتوقيت الجزائر','الصنف','المرحلة','السبب','الوزن كغ','السعر دج/كغ','التكلفة دج','المصدر','الحفظ','ملاحظة'],
      ...reportFiltered.map(r=>[dateFormatter.format(new Date(r.timestamp)),FOODS[r.food].label,STAGES[r.stage].label,REASONS[r.reason].label,r.weight,r.unitCost,r.cost,r.source,demo?'demo':pendingIds.has(r.id)?'pending':'confirmed',r.note])
    ]),'text/csv;charset=utf-8');
  }
  function initializeEnhancements() {
    $('#demoLogin').addEventListener('click',()=>{
      authAttempt++;
      demo=true;account=null;pending=[];records=loadRecords();settings=structuredClone(defaultSettings);
      try {const saved=localStorage.getItem('mawazin-demo-settings-v2');if(saved)settings=validateSettings(JSON.parse(saved));} catch { /* Keep usable defaults. */ }
      $('#inputMode').value='simulator';enterApplication();
    });
    $('#resumeSession').addEventListener('click',startAccount);
    $('#logoutButton').addEventListener('click',logout);$('#mobileLogout').addEventListener('click',logout);
    $('#inputMode').addEventListener('change',setInputMode);
    $('#manualWeight').addEventListener('input',event=>{manualWeight=Number(event.target.value);updateCostPreview();});
    $('#settingsForm').addEventListener('submit',saveSettings);
    $('#syncButton').addEventListener('click',synchronize);
    $('#checkConnection').addEventListener('click',async()=>{
      if(demo){showToast('وضع التجربة','هذا الوضع لا يتصل بقاعدة بيانات.');return;}
      try{await api('/api/health');showToast('الخادم يستجيب','تم تأكيد اتصال الخادم بقاعدة البيانات.');}catch(error){showToast('فشل فحص الاتصال',error.message,true);}
    });
    $('#backupButton').addEventListener('click',()=>download('mawazin-backup.json',JSON.stringify({version:2,exportedAt:new Date().toISOString(),demo,settings,records,pending},null,2),'application/json'));
    $('#legacyBackup').addEventListener('click',()=>{
      try {const legacy=localStorage.getItem(STORAGE_KEY);if(!legacy){showToast('لا توجد بيانات قديمة','لم نعثر على سجلات النسخة الأولى في هذا المتصفح.');return;}download('mawazin-legacy.json',legacy,'application/json');}
      catch {showToast('تعذر القراءة','التخزين المحلي غير متاح.',true);}
    });
    $('#reportFood').innerHTML='<option value="">كل الأصناف</option>'+Object.entries(FOODS).map(([key,v])=>`<option value="${key}">${v.label}</option>`).join('');
    $('#reportStage').innerHTML='<option value="">كل المراحل</option>'+Object.entries(STAGES).map(([key,v])=>`<option value="${key}">${v.label}</option>`).join('');
    $('#reportEnd').value=dayKey(new Date());$('#reportStart').value=dayKey(new Date(Date.now()-6*86400000));
    $('#reportFilters').addEventListener('submit',event=>{event.preventDefault();reportPage=1;renderReport();});
    $('#reportPrev').addEventListener('click',()=>{reportPage--;renderReport();});
    $('#reportNext').addEventListener('click',()=>{reportPage++;renderReport();});
    $('#reportExport').addEventListener('click',exportReport);
    $('#reportPrint').addEventListener('click',()=>{renderReport();if($('#reportError').textContent)return;$('#reportRows').innerHTML=rowsHtml(reportFiltered);window.print();});
    window.addEventListener('afterprint',()=>{if(!$('#reportsView').hidden)renderReport();});
    window.addEventListener('online',()=>{renderNetwork();void synchronize();});window.addEventListener('offline',renderNetwork);
    setInterval(()=>{if(!demo&&account&&!syncing)void synchronize();},60000);
    if('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').then(reg=>{
      if(reg.active)$('#offlineReadiness').textContent='واجهة التطبيق متاحة دون اتصال بعد التحميل. الدخول الجديد يحتاج الإنترنت؛ تبقى التسجيلات المعلقة محفوظة.';
    }).catch(()=>{ $('#offlineReadiness').textContent='التخزين المؤقت للواجهة غير متاح. أبقِ الصفحة مفتوحة عند انقطاع الإنترنت.'; });
    void startAccount();
  }

  function initialize() {
    initializeForm();
    bindEvents();
    renderScale();
    renderWorkerRecent();
    renderDashboard();
    initializeEnhancements();
    addEvent("اتصال ناجح", "الجهاز SC-DZ-001 يرسل القراءات");
    addEvent("قراءة مستقرة", `${DEFAULT_WEIGHT.toFixed(3)} كغ جاهزة للتسجيل`);
    updateClock();
    setInterval(updateClock, 1000);
    setInterval(() => {
      if (scale.connected && !scale.stable) {
        const jitter = (Math.random() - 0.5) * 0.045;
        scale.displayWeight = Math.max(0, scale.weight + jitter);
        renderScale();
      }
    }, 380);
  }

  initialize();
})();
