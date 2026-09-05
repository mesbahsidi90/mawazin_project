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
    simulator: { eyebrow: "وضع الاختبار", title: "محاكي الميزان" }
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

  let records = loadRecords();
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
      timestamp: atDayOffset(daysAgo, hour, minute),
      food,
      stage,
      reason,
      meal,
      weight: Number(weight.toFixed(3)),
      unitCost,
      cost: Math.round(weight * unitCost),
      source: "demo"
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
      const stored = JSON.parse(localStorage.getItem(STORAGE_KEY));
      if (Array.isArray(stored) && stored.length) return stored;
    } catch (error) {
      console.warn("تعذر تحميل البيانات المحلية", error);
    }
    const seeded = seedRecords();
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(seeded));
    } catch (error) {
      console.warn("تعذر حفظ البيانات التجريبية", error);
    }
    return seeded;
  }

  function saveRecords() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(records));
    } catch (error) {
      showToast("تعذر الحفظ", "مساحة التخزين المحلية غير متاحة في هذا المتصفح.", true);
    }
  }

  function populateSelect(select, data) {
    select.innerHTML = Object.entries(data)
      .map(([value, item]) => `<option value="${value}">${item.label}</option>`)
      .join("");
  }

  function initializeForm() {
    populateSelect($("#foodSelect"), FOODS);
    populateSelect($("#stageSelect"), STAGES);
    populateSelect($("#reasonSelect"), REASONS);
    $("#stageSelect").value = "buffet";
    $("#reasonSelect").value = "overproduction";
  }

  function switchView(name) {
    if (!VIEW_META[name]) return;

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
    const food = FOODS[$("#foodSelect").value] || FOODS.rice;
    const weight = scale.connected ? scale.weight : 0;
    $("#previewWeight").textContent = `${weight.toFixed(3)} كغ`;
    $("#previewCost").textContent = `${integerFormatter.format(Math.round(weight * food.unitCost))} دج`;

    const canRecord = scale.connected && scale.stable && scale.weight >= 0.02;
    $("#recordButton").disabled = !canRecord;
    $("#recordHint").textContent = !scale.connected
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

  function handleRecord(event) {
    event.preventDefault();
    if (!scale.connected) {
      showToast("الميزان غير متصل", "فعّل الاتصال من شاشة المحاكي ثم حاول مجددًا.", true);
      return;
    }
    if (!scale.stable) {
      showToast("القراءة غير مستقرة", "انتظر لحظة حتى تثبت الحمولة.", true);
      return;
    }
    if (scale.weight < 0.02) {
      showToast("لا توجد حمولة", "ضع الهدر على الميزان قبل التسجيل.", true);
      return;
    }

    const food = $("#foodSelect").value;
    const stage = $("#stageSelect").value;
    const reason = $("#reasonSelect").value;
    const meal = $('input[name="meal"]:checked').value;
    const weight = scale.weight;
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
      source: "operator"
    };

    records.unshift(record);
    saveRecords();
    renderWorkerRecent();
    renderDashboard();
    addEvent("تم إرسال سجل", `${FOODS[food].label} — ${weight.toFixed(3)} كغ`);
    showToast("تم تسجيل الهدر", `${FOODS[food].label}، ${weight.toFixed(3)} كغ، بقيمة ${integerFormatter.format(record.cost)} دج.`);

    setTimeout(() => setWeight(0), 520);
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
    const { start, end } = periodBounds(period, previous);
    return records.filter((record) => {
      const time = new Date(record.timestamp);
      return time >= start && time < end;
    });
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
    trend.classList.toggle("positive", isReduction);
    trend.classList.toggle("negative", !isReduction);
    $("#kpiWeightNote").textContent = isReduction ? "أقل من الفترة السابقة" : "أعلى من الفترة السابقة";
    $("#kpiAvoidableNote").textContent = `${numberFormatter.format(avoidableWeight)} كغ قابلة للتدخل`;
    $("#kpiEntriesNote").textContent = dashboardPeriod === 1 ? "منذ بداية اليوم" : `خلال آخر ${dashboardPeriod} أيام`;
  }

  function createChartBuckets(period) {
    const { start } = periodBounds(period);
    const bucketDays = period > 10 ? 3 : 1;
    const buckets = [];
    for (let offset = 0; offset < period; offset += bucketDays) {
      const bucketStart = new Date(start);
      bucketStart.setDate(bucketStart.getDate() + offset);
      const bucketEnd = new Date(bucketStart);
      bucketEnd.setDate(bucketEnd.getDate() + Math.min(bucketDays, period - offset));
      const weight = sum(records.filter((record) => {
        const time = new Date(record.timestamp);
        return time >= bucketStart && time < bucketEnd;
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
    const reductionKg = topFood[1] * 0.15;
    $("#insightTag").textContent = `${foodLabel} · ${numberFormatter.format(topFood[1])} كغ`;
    $("#insightTitle").textContent = `اخفض دفعة ${foodLabel} التالية بنحو 15%.`;
    $("#insightText").textContent = `تركز أعلى هدر في «${stageLabel}». ابدأ بتقليل التحضير بنحو ${numberFormatter.format(reductionKg)} كغ، ثم راقب نفاد الصنف ورضا المستفيدين.`;
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
  }

  function renderDashboard() {
    const filtered = recordsWithin(dashboardPeriod);
    renderKpis(filtered);
    renderDailyChart();
    renderPareto(filtered);
    renderStages(filtered);
    renderInsight(filtered);
    renderTable(filtered);
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

    $("#foodSelect").addEventListener("change", updateCostPreview);
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

  function initialize() {
    initializeForm();
    bindEvents();
    renderScale();
    renderWorkerRecent();
    renderDashboard();
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
