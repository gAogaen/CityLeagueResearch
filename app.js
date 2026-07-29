(() => {
  "use strict";

  const CONFIG = {
    password: "cityboy2026",
    dataUrl: "./data/cityleague_results.csv",
    storeMapUrl: "./data/store_prefecture_map.csv",
    pageSize: 40,
    recencyDecay: 0.70,
    shrinkageN: 24,
    minimumPlayerIdDigits: 8,
    ...(window.CITY_LEAGUE_CONFIG || {})
  };

  const PREFECTURES = [
    "北海道","青森県","岩手県","宮城県","秋田県","山形県","福島県",
    "茨城県","栃木県","群馬県","埼玉県","千葉県","東京都","神奈川県",
    "新潟県","富山県","石川県","福井県","山梨県","長野県",
    "岐阜県","静岡県","愛知県","三重県",
    "滋賀県","京都府","大阪府","兵庫県","奈良県","和歌山県",
    "鳥取県","島根県","岡山県","広島県","山口県",
    "徳島県","香川県","愛媛県","高知県",
    "福岡県","佐賀県","長崎県","熊本県","大分県","宮崎県","鹿児島県","沖縄県"
  ];

  const HEADER_ALIASES = {
    date: ["開催日", "event_date", "date"],
    eventName: ["大会名", "event_name"],
    shop: ["店名", "店舗名", "会場名", "主催者", "shop_name", "venue_name"],
    venuePrefecture: ["開催都道府県", "会場都道府県", "店舗都道府県", "都道府県", "venue_prefecture", "prefecture"],
    category: ["大会カテゴリ", "カテゴリ", "league_category", "category"],
    rank: ["順位", "rank"],
    csp: ["獲得CSP", "獲得ポイント", "CSP", "csp", "points", "earned_points"],
    annualCsp: ["年間CSP", "年間合計CSP", "年度CSP", "annual_csp", "season_csp"],
    playerId: ["プレイヤーID", "player_id"],
    playerName: ["プレイヤー名", "ユーザー名", "player_name", "user_name"],
    deckName: ["デッキ名", "deck_name"],
    deckCode: ["デッキコード", "deck_code"],
    eventId: ["大会ID", "event_id"],
    detailUrl: ["詳細URL", "デッキURL", "detail_url", "deck_url"],
    sourceText: ["元テキスト", "source_text", "raw_text"],
    fetchedAt: ["取得日時", "fetched_at"]
  };

  const state = {
    loaded: false,
    rows: [],
    filteredRows: [],
    playerAnnual: new Map(),
    latestNames: new Map(),
    years: [],
    categories: [],
    prefectures: [],
    storeMap: new Map(),
    quality: {},
    currentPage: 1,
    activeTab: "results",
    strengthRows: [],
    strengthParent: null,
    analysisCache: new Map()
  };

  const $ = (id) => document.getElementById(id);
  const finite = (value) => Number.isFinite(value);

  document.addEventListener("DOMContentLoaded", initialize);

  function initialize() {
    bindAuthentication();
    bindTabs();
    bindSearchControls();
    bindStrengthControls();

    if (sessionStorage.getItem("cityleague-auth") === "ok") {
      showApp();
    }
  }

  function bindAuthentication() {
    $("passwordForm").addEventListener("submit", (event) => {
      event.preventDefault();
      if ($("passwordInput").value === CONFIG.password) {
        sessionStorage.setItem("cityleague-auth", "ok");
        $("passwordError").hidden = true;
        showApp();
      } else {
        $("passwordError").hidden = false;
      }
    });

    $("logoutButton").addEventListener("click", () => {
      sessionStorage.removeItem("cityleague-auth");
      location.reload();
    });
  }

  function bindTabs() {
    document.querySelectorAll(".tab-button").forEach((button) => {
      button.addEventListener("click", () => setTab(button.dataset.tab));
    });
  }

  function bindSearchControls() {
    $("searchButton").addEventListener("click", applySearch);
    $("searchResetButton").addEventListener("click", resetSearch);
    $("resultCsvButton").addEventListener("click", exportSearchCsv);
    $("prevPageButton").addEventListener("click", () => changePage(-1));
    $("nextPageButton").addEventListener("click", () => changePage(1));

    ["playerIdFilter", "shopFilter"].forEach((id) => {
      $(id).addEventListener("keydown", (event) => {
        if (event.key === "Enter") applySearch();
      });
    });
  }

  function bindStrengthControls() {
    $("strengthApplyButton").addEventListener("click", renderStrength);
    $("strengthCsvButton").addEventListener("click", exportStrengthCsv);
    ["strengthPrefectureFilter", "strengthYearFilter", "strengthCategoryFilter", "strengthRankFilter"].forEach((id) => {
      $(id).addEventListener("change", renderStrength);
    });

    $("strengthTableBody").addEventListener("click", (event) => {
      const row = event.target.closest("tr[data-prefecture]");
      if (!row) return;
      $("strengthPrefectureFilter").value = row.dataset.prefecture;
      renderStrength();
      window.scrollTo({ top: $("strengthView").offsetTop - 10, behavior: "smooth" });
    });
  }

  function showApp() {
    $("lockScreen").hidden = true;
    $("app").hidden = false;
    if (!state.loaded) loadData();
  }

  function setTab(tabName) {
    state.activeTab = tabName;
    document.querySelectorAll(".tab-button").forEach((button) => {
      const active = button.dataset.tab === tabName;
      button.classList.toggle("active", active);
      button.setAttribute("aria-selected", String(active));
    });
    $("resultsView").classList.toggle("active", tabName === "results");
    $("strengthView").classList.toggle("active", tabName === "strength");
    if (tabName === "strength" && state.loaded) renderStrength();
  }

  async function loadData() {
    setLoading("店舗・都道府県マッピングを確認中...");
    try {
      state.storeMap = await loadStoreMap(CONFIG.storeMapUrl);
      setLoading("シティリーグ結果CSVを取得中...");
      const response = await fetch(CONFIG.dataUrl, { cache: "no-store" });
      if (!response.ok) throw new Error(`CSVを取得できませんでした（HTTP ${response.status}）`);
      const text = await response.text();
      setLoading("CSVを解析し、プレイヤーID単位で年間CSPを集計中...");
      await nextFrame();
      const rawRows = parseCsv(text);
      const normalized = normalizeDataset(rawRows, state.storeMap);
      state.rows = normalized.rows;
      state.playerAnnual = normalized.playerAnnual;
      state.latestNames = normalized.latestNames;
      state.quality = normalized.quality;
      state.years = uniqueSorted(state.rows.map((row) => row.seriesYear).filter(Boolean), true);
      state.categories = uniqueSorted(state.rows.map((row) => row.category).filter(Boolean));
      state.prefectures = uniqueSorted(state.rows.map((row) => row.prefecture).filter(Boolean), false, prefectureOrder);
      state.loaded = true;

      populateFilters();
      $("totalCount").textContent = formatNumber(state.rows.length);
      $("loadingPanel").hidden = true;
      renderDataAlert();
      applySearch();
      renderStrength();
    } catch (error) {
      console.error(error);
      $("loadingPanel").innerHTML = `<div class="error"><b>読み込みに失敗しました。</b><p>${escapeHtml(error.message)}</p></div>`;
    }
  }

  async function loadStoreMap(url) {
    const map = new Map();
    if (!url) return map;
    try {
      const response = await fetch(url, { cache: "no-store" });
      if (!response.ok) return map;
      const rows = parseCsv(await response.text());
      rows.forEach((row) => {
        const shop = normalizeShop(getAlias(row, HEADER_ALIASES.shop));
        const prefecture = normalizePrefecture(getAlias(row, HEADER_ALIASES.venuePrefecture));
        if (shop && prefecture) map.set(normalizeShopKey(shop), prefecture);
      });
    } catch (error) {
      console.warn("店舗都道府県マップを読み込めませんでした。", error);
    }
    return map;
  }

  function setLoading(message) {
    $("loadingMessage").textContent = message;
  }

  function nextFrame() {
    return new Promise((resolve) => requestAnimationFrame(() => resolve()));
  }

  function normalizeDataset(rawRows, storeMap) {
    const eventMeta = buildEventMetadata(rawRows, storeMap);
    const quality = {
      rawRows: rawRows.length,
      excludedInvalidId: 0,
      excludedInvalidRank: 0,
      excludedAggregateRow: 0,
      duplicatesRemoved: 0,
      missingVenuePrefecture: 0,
      missingCsp: 0,
      fallbackCsp: 0,
      directAnnualCspKeys: 0,
      summedAnnualCspKeys: 0
    };

    const deduped = new Map();

    rawRows.forEach((raw, index) => {
      const sourceText = cleanText(getAlias(raw, HEADER_ALIASES.sourceText));
      const rawIds = [...sourceText.matchAll(/(?:プレイヤーID\s*[:：]\s*)?(\d{8,12})/g)].map((match) => match[1]);
      const uniqueRawIds = new Set(rawIds);
      const detailUrl = cleanText(getAlias(raw, HEADER_ALIASES.detailUrl));

      if (uniqueRawIds.size > 1 && !detailUrl) {
        quality.excludedAggregateRow += 1;
        return;
      }

      const playerId = normalizePlayerId(getAlias(raw, HEADER_ALIASES.playerId) || sourceText);
      if (!playerId) {
        quality.excludedInvalidId += 1;
        return;
      }

      const rank = parsePositiveInt(getAlias(raw, HEADER_ALIASES.rank)) || extractRank(sourceText);
      if (!rank) {
        quality.excludedInvalidRank += 1;
        return;
      }

      const eventId = normalizeEventId(getAlias(raw, HEADER_ALIASES.eventId));
      const meta = eventId ? eventMeta.get(eventId) || {} : {};
      const eventName = cleanText(getAlias(raw, HEADER_ALIASES.eventName) || meta.eventName);
      const date = normalizeDate(getAlias(raw, HEADER_ALIASES.date) || meta.date);
      const seriesYear = extractSeriesYear(eventName, date);
      const category = normalizeCategory(getAlias(raw, HEADER_ALIASES.category) || extractCategory(eventName));
      const season = extractSeason(eventName);
      const explicitShop = normalizeShop(getAlias(raw, HEADER_ALIASES.shop));
      const shop = chooseShop(explicitShop, meta.shop);
      const explicitPrefecture = normalizePrefecture(getAlias(raw, HEADER_ALIASES.venuePrefecture));
      const prefecture = explicitPrefecture || storeMap.get(normalizeShopKey(shop)) || meta.prefecture || "";
      const playerName = normalizePlayerName(getAlias(raw, HEADER_ALIASES.playerName), playerId, sourceText);
      const cspResult = extractCsp(raw, sourceText, rank, seriesYear);
      const annualCspProvided = parseNonNegativeNumber(getAlias(raw, HEADER_ALIASES.annualCsp));

      if (!prefecture) quality.missingVenuePrefecture += 1;
      if (!finite(cspResult.value)) quality.missingCsp += 1;
      if (cspResult.source === "rank-fallback") quality.fallbackCsp += 1;

      const row = {
        sourceIndex: index,
        date,
        eventName,
        shop,
        prefecture,
        category,
        season,
        seriesYear,
        rank,
        csp: cspResult.value,
        cspSource: cspResult.source,
        annualCspProvided,
        playerId,
        playerName,
        deckName: normalizeDeckName(getAlias(raw, HEADER_ALIASES.deckName)),
        deckCode: cleanText(getAlias(raw, HEADER_ALIASES.deckCode)),
        eventId,
        detailUrl,
        fetchedAt: cleanText(getAlias(raw, HEADER_ALIASES.fetchedAt))
      };

      const eventKey = eventId || [date, eventName, shop].join("|");
      row.eventKey = eventKey;
      const key = `${eventKey}|${playerId}|${rank}`;
      if (deduped.has(key)) {
        quality.duplicatesRemoved += 1;
        deduped.set(key, mergeDuplicateRows(deduped.get(key), row));
      } else {
        deduped.set(key, row);
      }
    });

    const rows = [...deduped.values()].sort(compareRows);
    const latestNames = buildLatestNameMap(rows);
    const playerAnnual = buildAnnualCsp(rows, quality);
    attachAnnualMetrics(rows, playerAnnual, latestNames);

    return { rows, playerAnnual, latestNames, quality };
  }

  function buildEventMetadata(rawRows, storeMap) {
    const map = new Map();
    rawRows.forEach((raw) => {
      const eventId = normalizeEventId(getAlias(raw, HEADER_ALIASES.eventId));
      if (!eventId) return;
      const sourceText = cleanText(getAlias(raw, HEADER_ALIASES.sourceText));
      const explicitShop = normalizeShop(getAlias(raw, HEADER_ALIASES.shop));
      const sourceShop = extractVenueShop(sourceText);
      const shop = chooseShop(sourceShop, explicitShop);
      const explicitPrefecture = normalizePrefecture(getAlias(raw, HEADER_ALIASES.venuePrefecture));
      const sourcePrefecture = extractVenuePrefecture(sourceText);
      const prefecture = explicitPrefecture || sourcePrefecture || storeMap.get(normalizeShopKey(shop)) || "";
      const candidate = {
        shop,
        prefecture,
        eventName: cleanText(getAlias(raw, HEADER_ALIASES.eventName)),
        date: normalizeDate(getAlias(raw, HEADER_ALIASES.date))
      };
      map.set(eventId, mergeEventMeta(map.get(eventId) || {}, candidate));
    });
    return map;
  }

  function mergeEventMeta(current, candidate) {
    return {
      shop: chooseShop(candidate.shop, current.shop),
      prefecture: candidate.prefecture || current.prefecture || "",
      eventName: chooseLongerMeaningful(current.eventName, candidate.eventName),
      date: chooseValidDate(current.date, candidate.date)
    };
  }

  function mergeDuplicateRows(a, b) {
    const better = rowQualityScore(b) > rowQualityScore(a) ? b : a;
    const other = better === b ? a : b;
    return {
      ...other,
      ...better,
      shop: chooseShop(better.shop, other.shop),
      prefecture: better.prefecture || other.prefecture,
      playerName: choosePlayerName(better.playerName, other.playerName, better.playerId),
      deckName: better.deckName || other.deckName,
      detailUrl: better.detailUrl || other.detailUrl,
      csp: finite(better.csp) ? better.csp : other.csp,
      cspSource: finite(better.csp) ? better.cspSource : other.cspSource,
      annualCspProvided: finite(better.annualCspProvided) ? better.annualCspProvided : other.annualCspProvided
    };
  }

  function rowQualityScore(row) {
    return (row.detailUrl ? 4 : 0) + (row.prefecture ? 3 : 0) + (row.shop ? 2 : 0) +
      (row.playerName ? 2 : 0) + (finite(row.csp) ? 2 : 0) + (row.deckName ? 1 : 0);
  }

  function buildLatestNameMap(rows) {
    const map = new Map();
    rows.forEach((row) => {
      if (!row.playerName) return;
      const current = map.get(row.playerId);
      const stamp = dateStamp(row.date) || dateStamp(row.fetchedAt) || 0;
      if (!current || stamp >= current.stamp) {
        map.set(row.playerId, { name: row.playerName, stamp });
      }
    });
    return map;
  }

  function buildAnnualCsp(rows, quality) {
    const buckets = new Map();
    rows.forEach((row) => {
      if (!row.seriesYear || !row.category) return;
      const key = annualKey(row.seriesYear, row.category, row.playerId);
      if (!buckets.has(key)) {
        buckets.set(key, {
          key,
          seriesYear: row.seriesYear,
          category: row.category,
          playerId: row.playerId,
          provided: [],
          eventCsp: new Map()
        });
      }
      const bucket = buckets.get(key);
      if (finite(row.annualCspProvided)) bucket.provided.push(row.annualCspProvided);
      if (finite(row.csp)) bucket.eventCsp.set(row.eventKey, row.csp);
    });

    const annual = new Map();
    buckets.forEach((bucket, key) => {
      const hasProvided = bucket.provided.length > 0;
      const hasEventCsp = bucket.eventCsp.size > 0;
      if (!hasProvided && !hasEventCsp) return;
      const value = hasProvided
        ? Math.max(...bucket.provided)
        : [...bucket.eventCsp.values()].reduce((sum, csp) => sum + csp, 0);
      const source = hasProvided ? "provided" : "city-sum";
      if (source === "provided") quality.directAnnualCspKeys += 1;
      else quality.summedAnnualCspKeys += 1;
      annual.set(key, { ...bucket, value, source, percentile: null });
    });

    const distributions = groupBy([...annual.values()], (item) => `${item.seriesYear}|${item.category}`);
    distributions.forEach((items) => assignPercentiles(items));
    return annual;
  }

  function assignPercentiles(items) {
    const sorted = [...items].sort((a, b) => a.value - b.value);
    const n = sorted.length;
    let index = 0;
    while (index < n) {
      let end = index + 1;
      while (end < n && sorted[end].value === sorted[index].value) end += 1;
      const midRankZeroBased = (index + (end - 1)) / 2;
      const percentile = n <= 1 ? 50 : (midRankZeroBased / (n - 1)) * 100;
      for (let i = index; i < end; i += 1) sorted[i].percentile = percentile;
      index = end;
    }
  }

  function attachAnnualMetrics(rows, playerAnnual, latestNames) {
    rows.forEach((row) => {
      const annual = playerAnnual.get(annualKey(row.seriesYear, row.category, row.playerId));
      row.annualCsp = annual?.value ?? null;
      row.annualCspSource = annual?.source || "";
      row.annualPercentile = annual?.percentile ?? null;
      row.latestPlayerName = latestNames.get(row.playerId)?.name || row.playerName || "";
    });
  }

  function populateFilters() {
    fillSelect($("resultYearFilter"), state.years, (year) => [`${year}`, `シティリーグ${year}`]);
    fillSelect($("resultCategoryFilter"), state.categories);
    fillSelect($("resultPrefectureFilter"), state.prefectures);
    fillSelect($("strengthPrefectureFilter"), state.prefectures);
    fillSelect($("strengthCategoryFilter"), state.categories);

    state.years.forEach((year) => {
      const option = document.createElement("option");
      option.value = String(year);
      option.textContent = `シティリーグ${year}`;
      $("strengthYearFilter").appendChild(option);
    });
  }

  function fillSelect(select, values, labelFactory) {
    values.forEach((value) => {
      const option = document.createElement("option");
      const [optionValue, label] = labelFactory ? labelFactory(value) : [value, value];
      option.value = optionValue;
      option.textContent = label;
      select.appendChild(option);
    });
  }

  function renderDataAlert() {
    const q = state.quality;
    const messages = [];
    if (q.missingVenuePrefecture > 0) {
      messages.push(`開催都道府県を判定できない結果が${formatNumber(q.missingVenuePrefecture)}件あります。必要に応じて data/store_prefecture_map.csv に店舗と都道府県を追加してください。`);
    }
    if (q.missingCsp > 0) {
      messages.push(`獲得CSPを判定できない結果が${formatNumber(q.missingCsp)}件あり、集中度分析から除外されます。`);
    }
    if (q.fallbackCsp > 0) {
      messages.push(`${formatNumber(q.fallbackCsp)}件は順位からCSPを補完しています。`);
    }
    if (messages.length) {
      $("dataAlert").hidden = false;
      $("dataAlert").textContent = messages.join(" ");
    }
  }

  function applySearch() {
    if (!state.loaded) return;
    const playerIdQuery = normalizeDigits($("playerIdFilter").value);
    const shopQuery = normalizeSearch($("shopFilter").value);
    const prefecture = $("resultPrefectureFilter").value;
    const year = $("resultYearFilter").value;
    const category = $("resultCategoryFilter").value;
    const maxRank = parsePositiveInt($("resultRankFilter").value);

    state.filteredRows = state.rows.filter((row) => {
      if (playerIdQuery && !row.playerId.includes(playerIdQuery)) return false;
      if (shopQuery && !normalizeSearch(row.shop).includes(shopQuery)) return false;
      if (prefecture && row.prefecture !== prefecture) return false;
      if (year && String(row.seriesYear) !== year) return false;
      if (category && row.category !== category) return false;
      if (maxRank && row.rank > maxRank) return false;
      return true;
    }).sort(compareRows);

    state.currentPage = 1;
    renderSearchResults();
  }

  function resetSearch() {
    ["playerIdFilter", "shopFilter"].forEach((id) => { $(id).value = ""; });
    ["resultPrefectureFilter", "resultYearFilter", "resultCategoryFilter", "resultRankFilter"].forEach((id) => { $(id).value = ""; });
    applySearch();
  }

  function changePage(delta) {
    const maxPage = Math.max(1, Math.ceil(state.filteredRows.length / CONFIG.pageSize));
    state.currentPage = Math.min(maxPage, Math.max(1, state.currentPage + delta));
    renderSearchResults();
  }

  function renderSearchResults() {
    const total = state.filteredRows.length;
    const maxPage = Math.max(1, Math.ceil(total / CONFIG.pageSize));
    state.currentPage = Math.min(state.currentPage, maxPage);
    const start = (state.currentPage - 1) * CONFIG.pageSize;
    const pageRows = state.filteredRows.slice(start, start + CONFIG.pageSize);

    $("resultSummary").textContent = `${formatNumber(total)}件 / プレイヤーID ${formatNumber(new Set(state.filteredRows.map((row) => row.playerId)).size)}名`;
    $("pageInfo").textContent = `${state.currentPage} / ${maxPage}ページ`;
    $("prevPageButton").disabled = state.currentPage <= 1;
    $("nextPageButton").disabled = state.currentPage >= maxPage;

    if (!pageRows.length) {
      $("searchResults").innerHTML = `<div class="empty">条件に一致する結果はありません。</div>`;
      return;
    }

    $("searchResults").innerHTML = pageRows.map(renderResultCard).join("");
    $("searchResults").querySelectorAll("[data-player-id]").forEach((button) => {
      button.addEventListener("click", () => {
        $("playerIdFilter").value = button.dataset.playerId;
        applySearch();
        window.scrollTo({ top: $("resultsView").offsetTop - 10, behavior: "smooth" });
      });
    });
  }

  function renderResultCard(row) {
    const annualLabel = finite(row.annualCsp) ? `${formatNumber(row.annualCsp)} pt` : "不明";
    const percentileLabel = finite(row.annualPercentile) ? `上位 ${formatDecimal(100 - row.annualPercentile, 1)}%帯` : "-";
    const sourceLabel = row.annualCspSource === "provided" ? "CSV年間CSP" : "シティ結果合算";
    const eventNameAtTime = row.playerName && row.playerName !== row.latestPlayerName
      ? `${escapeHtml(row.playerName)} → 現在表示名 ${escapeHtml(row.latestPlayerName)}`
      : escapeHtml(row.latestPlayerName || row.playerName || "名称不明");
    const officialLink = row.detailUrl
      ? `<a href="${escapeAttr(row.detailUrl)}" target="_blank" rel="noopener noreferrer">公式デッキ</a>`
      : row.eventId
        ? `<a href="https://players.pokemon-card.com/event/detail/${encodeURIComponent(row.eventId)}/result" target="_blank" rel="noopener noreferrer">大会ページ</a>`
        : "";

    return `
      <article class="result-card">
        <div class="result-top">
          <div>
            <h3 class="result-title">${escapeHtml(row.shop || "会場名不明")}</h3>
            <div class="chips">
              <span class="chip">${escapeHtml(row.prefecture || "都道府県不明")}</span>
              <span class="chip">シティ${escapeHtml(String(row.seriesYear || "-"))}</span>
              <span class="chip">${escapeHtml(row.season || "シーズン不明")}</span>
              <span class="chip">${escapeHtml(row.category || "カテゴリ不明")}</span>
            </div>
          </div>
          <span class="rank-badge">${row.rank}位</span>
        </div>
        <div class="result-data">
          <div><b>開催日：</b><span>${escapeHtml(row.date || "-")}</span></div>
          <div><b>獲得CSP：</b><span>${finite(row.csp) ? `${formatNumber(row.csp)} pt` : "不明"}</span></div>
          <div><b>プレイヤーID：</b><span>${escapeHtml(row.playerId)}</span></div>
          <div><b>登録名：</b><span>${eventNameAtTime}</span></div>
          <div><b>年間CSP：</b><span>${annualLabel}（${sourceLabel}）</span></div>
          <div><b>年度内位置：</b><span>${percentileLabel}</span></div>
          <div><b>デッキ：</b><span>${escapeHtml(row.deckName || "未取得")}</span></div>
          <div><b>大会ID：</b><span>${escapeHtml(row.eventId || "-")}</span></div>
        </div>
        <div class="result-actions">
          ${officialLink}
          <button class="link-button secondary" data-player-id="${escapeAttr(row.playerId)}">このIDを検索</button>
        </div>
      </article>`;
  }

  function renderStrength() {
    if (!state.loaded) return;
    const prefecture = $("strengthPrefectureFilter").value;
    const yearMode = $("strengthYearFilter").value;
    const category = $("strengthCategoryFilter").value;
    const rankMode = $("strengthRankFilter").value;
    const cacheKey = [prefecture, yearMode, category, rankMode].join("|");
    let result = state.analysisCache.get(cacheKey);
    if (!result) {
      result = calculateStrength({ prefecture, yearMode, category, rankMode });
      state.analysisCache.set(cacheKey, result);
    }

    state.strengthRows = result.entities;
    state.strengthParent = result.parent;
    renderStrengthCards(result.parent, result.context);
    renderStrengthTable(result.entities, Boolean(prefecture));
    $("strengthSummary").textContent = `${result.context.yearLabel} / ${category || "全カテゴリ"} / ${rankModeLabel(rankMode)} / ${formatNumber(result.context.eligibleRows)}件`;
  }

  function calculateStrength({ prefecture, yearMode, category, rankMode }) {
    const targetYears = resolveTargetYears(yearMode);
    const maxRank = rankMode === "top4" ? 4 : rankMode === "top8" ? 8 : Infinity;
    const eligible = state.rows.filter((row) => {
      if (!row.prefecture || !finite(row.annualPercentile) || !finite(row.annualCsp)) return false;
      if (!targetYears.includes(row.seriesYear)) return false;
      if (category && row.category !== category) return false;
      if (row.rank > maxRank) return false;
      if (prefecture && row.prefecture !== prefecture) return false;
      return true;
    });

    const mode = prefecture ? "shop" : "prefecture";
    const entityKey = mode === "shop"
      ? (row) => `${row.prefecture}|${row.shop || "会場名不明"}`
      : (row) => row.prefecture;
    const entityLabel = mode === "shop"
      ? (key) => key.split("|").slice(1).join("|")
      : (key) => key;

    const eventMap = groupBy(eligible, (row) => row.eventKey);
    const eventStats = [];
    eventMap.forEach((eventRows, eventKey) => {
      const first = eventRows[0];
      const percentiles = eventRows.map((row) => row.annualPercentile).filter(finite);
      if (!percentiles.length) return;
      eventStats.push({
        eventKey,
        entityKey: entityKey(first),
        seriesYear: first.seriesYear,
        count: eventRows.length,
        strength: mean(percentiles.map((value) => (value * value) / 100)),
        medianPercentile: percentile(percentiles, 0.5),
        q1Percentile: percentile(percentiles, 0.25),
        top10Rate: percentiles.filter((value) => value >= 90).length / percentiles.length,
        top25Rate: percentiles.filter((value) => value >= 75).length / percentiles.length
      });
    });

    const baseline = calculateParentStats(eligible, eventStats, targetYears, "選択範囲全体", null);
    const groupedEvents = groupBy(eventStats, (item) => item.entityKey);
    const groupedRows = groupBy(eligible, (row) => entityKey(row));
    const entities = [];

    groupedEvents.forEach((events, key) => {
      const stats = calculateEntityStats(groupedRows.get(key) || [], events, targetYears, baseline.rawStrength);
      entities.push({ key, label: entityLabel(key), prefecture: mode === "prefecture" ? key : prefecture, ...stats });
    });

    entities.sort((a, b) => b.adjustedStrength - a.adjustedStrength || b.eventCount - a.eventCount || a.label.localeCompare(b.label, "ja"));
    const parentLabel = prefecture || "全国";
    const parent = calculateParentStats(eligible, eventStats, targetYears, parentLabel, baseline.rawStrength);
    const yearLabel = yearMode === "recent3" ? `直近3年（${targetYears.join("・")}）` : yearMode === "all" ? `全期間（${targetYears.join("・")}）` : `シティリーグ${yearMode}`;

    return {
      entities,
      parent,
      context: { mode, targetYears, yearLabel, eligibleRows: eligible.length, prefecture }
    };
  }

  function calculateParentStats(rows, events, targetYears, label, shrinkBaseline) {
    if (!events.length) {
      return {
        label, adjustedStrength: 0, rawStrength: 0, medianPercentile: 0, q1Percentile: 0,
        top10Rate: 0, top25Rate: 0, avgAnnualCsp: 0, stdAnnualCsp: 0,
        eventCount: 0, uniquePlayers: 0, yearsCount: 0, trend: null, trust: "low"
      };
    }
    const baseline = finite(shrinkBaseline) ? shrinkBaseline : weightedEventMetric(events, targetYears, "strength");
    return { label, ...calculateEntityStats(rows, events, targetYears, baseline, true) };
  }

  function calculateEntityStats(rows, events, targetYears, shrinkBaseline, isParent = false) {
    const yearGroups = groupBy(events, (event) => event.seriesYear);
    const yearMetrics = targetYears.map((year) => {
      const yearEvents = yearGroups.get(year) || [];
      if (!yearEvents.length) return null;
      return {
        year,
        strength: mean(yearEvents.map((event) => event.strength)),
        medianPercentile: mean(yearEvents.map((event) => event.medianPercentile)),
        q1Percentile: mean(yearEvents.map((event) => event.q1Percentile)),
        top10Rate: weightedMean(yearEvents.map((event) => [event.top10Rate, event.count])),
        top25Rate: weightedMean(yearEvents.map((event) => [event.top25Rate, event.count])),
        eventCount: yearEvents.length,
        appearanceCount: yearEvents.reduce((sum, event) => sum + event.count, 0)
      };
    }).filter(Boolean);

    const latestYear = Math.max(...targetYears);
    const yearWeight = (year) => Math.pow(CONFIG.recencyDecay, Math.max(0, latestYear - year));
    const rawStrength = weightedMean(yearMetrics.map((item) => [item.strength, yearWeight(item.year)]));
    const medianPercentile = weightedMean(yearMetrics.map((item) => [item.medianPercentile, yearWeight(item.year)]));
    const q1Percentile = weightedMean(yearMetrics.map((item) => [item.q1Percentile, yearWeight(item.year)]));
    const top10Rate = weightedMean(yearMetrics.map((item) => [item.top10Rate, yearWeight(item.year) * item.appearanceCount]));
    const top25Rate = weightedMean(yearMetrics.map((item) => [item.top25Rate, yearWeight(item.year) * item.appearanceCount]));
    const eventCount = events.length;
    const appearanceCount = rows.length;
    const reliability = isParent ? 1 : Math.min(1, appearanceCount / (appearanceCount + CONFIG.shrinkageN));
    const adjustedStrength = shrinkBaseline + reliability * (rawStrength - shrinkBaseline);

    const playerYearMap = new Map();
    rows.forEach((row) => {
      const key = `${row.seriesYear}|${row.playerId}`;
      if (!playerYearMap.has(key)) playerYearMap.set(key, row);
    });
    const playerYearRows = [...playerYearMap.values()];
    const weightedCspPairs = playerYearRows.map((row) => [row.annualCsp, yearWeight(row.seriesYear)]);
    const avgAnnualCsp = weightedMean(weightedCspPairs);
    const stdAnnualCsp = weightedStd(weightedCspPairs, avgAnnualCsp);
    const uniquePlayers = new Set(rows.map((row) => row.playerId)).size;
    const trendValue = linearSlope(yearMetrics.map((item) => [item.year, item.strength]));
    const yearlyStd = populationStd(yearMetrics.map((item) => item.strength));
    const trust = eventCount >= 6 && uniquePlayers >= 30 ? "high" : eventCount >= 3 && uniquePlayers >= 15 ? "medium" : "low";

    return {
      adjustedStrength,
      rawStrength,
      medianPercentile,
      q1Percentile,
      top10Rate,
      top25Rate,
      avgAnnualCsp,
      stdAnnualCsp,
      eventCount,
      appearanceCount,
      uniquePlayers,
      yearsCount: yearMetrics.length,
      trend: trendValue,
      yearlyStd,
      reliability,
      trust
    };
  }

  function weightedEventMetric(events, targetYears, field) {
    const latestYear = Math.max(...targetYears);
    return weightedMean(events.map((event) => [event[field], Math.pow(CONFIG.recencyDecay, Math.max(0, latestYear - event.seriesYear))]));
  }

  function renderStrengthCards(parent, context) {
    const title = context.prefecture ? `${context.prefecture}のポイント圏` : "全国のポイント圏";
    const cards = [
      ["集計対象", title, `${context.yearLabel}・${rankModeLabel($("strengthRankFilter").value)}`],
      ["強豪選手集中度", formatDecimal(parent.adjustedStrength, 1), "上位CSP帯を強く評価した0〜100指標"],
      ["CSP中央値帯", `上位 ${formatDecimal(100 - parent.medianPercentile, 1)}%`, "ポイント圏選手の典型的な年度内位置"],
      ["年間上位10%率", formatPercent(parent.top10Rate, 1), "ポイント圏に占める年間上位10%選手"],
      ["集計母数", `${formatNumber(parent.eventCount)}大会`, `${formatNumber(parent.uniquePlayers)}プレイヤーID・${parent.yearsCount}年度`]
    ];
    $("strengthCards").innerHTML = cards.map(([label, value, note]) => `
      <article class="metric-card"><span>${escapeHtml(label)}</span><b>${escapeHtml(String(value))}</b><small>${escapeHtml(note)}</small></article>
    `).join("");
  }

  function renderStrengthTable(entities, storeMode) {
    $("entityHeader").textContent = storeMode ? "店舗" : "都道府県";
    $("strengthTableTitle").textContent = storeMode
      ? `${$("strengthPrefectureFilter").value} 店舗別 強豪選手集中度`
      : "都道府県別 強豪選手集中度";
    $("strengthTableDescription").textContent = storeMode
      ? "同県内の店舗を、ポイント圏選手の年間CSP分布で比較します。"
      : "都道府県の行を選択すると、その県の店舗一覧へ切り替わります。";

    if (!entities.length) {
      $("strengthTableBody").innerHTML = `<tr><td colspan="12" class="empty">条件に一致する分析対象がありません。</td></tr>`;
      return;
    }

    $("strengthTableBody").innerHTML = entities.map((item, index) => {
      const scoreClass = item.adjustedStrength >= 60 ? "high" : item.adjustedStrength >= 40 ? "medium" : "low";
      const trend = trendLabel(item.trend);
      const clickable = !storeMode;
      return `
        <tr ${clickable ? `data-clickable="true" data-prefecture="${escapeAttr(item.prefecture)}"` : ""}>
          <td>${index + 1}</td>
          <td><span class="entity-name">${escapeHtml(item.label || "会場名不明")}</span></td>
          <td class="number"><span class="score ${scoreClass}">${formatDecimal(item.adjustedStrength, 1)}</span></td>
          <td class="number">上位 ${formatDecimal(100 - item.medianPercentile, 1)}%</td>
          <td class="number">上位 ${formatDecimal(100 - item.q1Percentile, 1)}%</td>
          <td class="number">${formatPercent(item.top10Rate, 1)}</td>
          <td class="number">${formatDecimal(item.avgAnnualCsp, 1)}</td>
          <td class="number">${formatDecimal(item.stdAnnualCsp, 1)}</td>
          <td class="number">${formatNumber(item.eventCount)}</td>
          <td class="number">${formatNumber(item.uniquePlayers)}</td>
          <td class="${trend.className}">${trend.text}</td>
          <td><span class="trust ${item.trust}">${trustLabel(item.trust)}</span></td>
        </tr>`;
    }).join("");
  }

  function resolveTargetYears(mode) {
    if (!state.years.length) return [];
    if (/^\d{4}$/.test(mode)) return [Number(mode)];
    if (mode === "recent3") return state.years.slice(0, 3).sort((a, b) => a - b);
    return [...state.years].sort((a, b) => a - b);
  }

  function exportSearchCsv() {
    const columns = [
      ["開催日", "date"], ["シリーズ年度", "seriesYear"], ["シーズン", "season"], ["開催都道府県", "prefecture"],
      ["店名", "shop"], ["大会カテゴリ", "category"], ["順位", "rank"], ["獲得CSP", "csp"],
      ["プレイヤーID", "playerId"], ["大会時登録名", "playerName"], ["最新表示名", "latestPlayerName"],
      ["年間CSP", "annualCsp"], ["年間CSPソース", "annualCspSource"], ["年度内パーセンタイル", "annualPercentile"],
      ["デッキ名", "deckName"], ["大会ID", "eventId"], ["詳細URL", "detailUrl"]
    ];
    downloadObjectCsv("cityleague_search_results.csv", state.filteredRows, columns);
  }

  function exportStrengthCsv() {
    const storeMode = Boolean($("strengthPrefectureFilter").value);
    const rows = state.strengthRows.map((item, index) => ({ rank: index + 1, ...item }));
    const columns = [
      ["順位", "rank"], [storeMode ? "店舗" : "都道府県", "label"], ["開催都道府県", "prefecture"],
      ["強豪選手集中度", "adjustedStrength"], ["生スコア", "rawStrength"], ["CSP中央値パーセンタイル", "medianPercentile"],
      ["CSP第25百分位パーセンタイル", "q1Percentile"], ["年間上位10%率", "top10Rate"], ["年間上位25%率", "top25Rate"],
      ["平均年間CSP", "avgAnnualCsp"], ["年間CSP標準偏差", "stdAnnualCsp"], ["大会数", "eventCount"],
      ["ポイント圏延べ人数", "appearanceCount"], ["ユニークプレイヤーID数", "uniquePlayers"], ["年度数", "yearsCount"],
      ["年次トレンド", "trend"], ["年次標準偏差", "yearlyStd"], ["信頼度", "trust"]
    ];
    downloadObjectCsv(storeMode ? "cityleague_shop_strength.csv" : "cityleague_prefecture_strength.csv", rows, columns);
  }

  function downloadObjectCsv(filename, rows, columns) {
    const lines = [columns.map(([header]) => csvEscape(header)).join(",")];
    rows.forEach((row) => {
      lines.push(columns.map(([, key]) => csvEscape(row[key] ?? "")).join(","));
    });
    const blob = new Blob(["\uFEFF", lines.join("\r\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = filename;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
  }

  function parseCsv(text) {
    const rows = [];
    let row = [];
    let field = "";
    let quoted = false;

    for (let i = 0; i < text.length; i += 1) {
      const char = text[i];
      if (quoted) {
        if (char === '"' && text[i + 1] === '"') {
          field += '"';
          i += 1;
        } else if (char === '"') {
          quoted = false;
        } else {
          field += char;
        }
      } else if (char === '"') {
        quoted = true;
      } else if (char === ",") {
        row.push(field);
        field = "";
      } else if (char === "\n") {
        row.push(field.replace(/\r$/, ""));
        if (row.some((value) => value !== "")) rows.push(row);
        row = [];
        field = "";
      } else {
        field += char;
      }
    }
    row.push(field.replace(/\r$/, ""));
    if (row.some((value) => value !== "")) rows.push(row);
    if (!rows.length) return [];

    const headers = rows[0].map((header, index) => (index === 0 ? header.replace(/^\uFEFF/, "") : header).trim());
    return rows.slice(1).map((values) => Object.fromEntries(headers.map((header, index) => [header, values[index] ?? ""])));
  }

  function getAlias(row, aliases) {
    for (const alias of aliases) {
      if (Object.prototype.hasOwnProperty.call(row, alias) && row[alias] !== "" && row[alias] != null) return row[alias];
    }
    return "";
  }

  function extractCsp(raw, sourceText, rank, seriesYear) {
    const direct = parseNonNegativeNumber(getAlias(raw, HEADER_ALIASES.csp));
    if (finite(direct)) return { value: direct, source: "column" };

    const rankPattern = new RegExp(`${rank}\\s*位[\\s\\S]{0,24}?(\\d{1,3})\\s*pt`, "i");
    const rankMatch = sourceText.match(rankPattern);
    if (rankMatch) return { value: Number(rankMatch[1]), source: "source-text" };

    const pointMatches = [...sourceText.matchAll(/(\d{1,3})\s*pt/gi)];
    if (pointMatches.length === 1) return { value: Number(pointMatches[0][1]), source: "source-text" };

    if (seriesYear >= 2024) {
      if (rank === 1) return { value: 100, source: "rank-fallback" };
      if (rank === 2) return { value: 75, source: "rank-fallback" };
      if (rank <= 4) return { value: 50, source: "rank-fallback" };
      if (rank <= 8) return { value: 25, source: "rank-fallback" };
      if (rank <= 16) return { value: 15, source: "rank-fallback" };
    }
    return { value: null, source: "unknown" };
  }

  function extractVenueShop(text) {
    const match = text.match(/主催者\s*[:：]\s*([^\n\r]+)/);
    return match ? normalizeShop(match[1]) : "";
  }

  function extractVenuePrefecture(text) {
    if (!text || (!text.includes("〒") && !text.includes("主催者") && !text.includes("開催地"))) return "";
    const postalMatch = text.match(/〒\s*\d{3}-?\d{4}[^\n\r]{0,100}?(北海道|(?:京都|大阪)府|東京都|.{2,3}県)/);
    if (postalMatch) return normalizePrefecture(postalMatch[1]);
    const locationMatch = text.match(/開催地\s*[:：]\s*(北海道|(?:京都|大阪)府|東京都|.{2,3}県)/);
    return locationMatch ? normalizePrefecture(locationMatch[1]) : "";
  }

  function normalizePlayerId(value) {
    const digits = normalizeDigits(value);
    const matches = String(value || "").match(new RegExp(`\\d{${CONFIG.minimumPlayerIdDigits},12}`, "g"));
    if (matches?.length) return matches[0];
    return digits.length >= CONFIG.minimumPlayerIdDigits && digits.length <= 12 ? digits : "";
  }

  function normalizeEventId(value) {
    const match = String(value || "").match(/\d+/);
    return match ? match[0] : "";
  }

  function normalizePlayerName(value, playerId, sourceText) {
    let name = cleanText(value);
    name = name.replace(/プレイヤーID[\s\S]*$/i, "").trim();
    if (!name || normalizeDigits(name) === playerId || /^(ユーザー名|プレイヤー名|イベント名)$/.test(name)) {
      const pattern = new RegExp(`([^\\n\\r]{1,60})[\\n\\r]+プレイヤーID\\s*[:：]\\s*${playerId}`);
      const match = sourceText.match(pattern);
      name = match ? cleanText(match[1]) : "";
    }
    return name.length <= 80 ? name : "";
  }

  function normalizeDeckName(value) {
    const text = cleanText(value);
    if (/プレイヤーID|参加デッキ|デッキを見る|デッキをみる/.test(text)) return "";
    return text;
  }

  function normalizeShop(value) {
    return cleanText(value)
      .replace(/^主催者\s*[:：]\s*/, "")
      .replace(/[\u3000\t]+/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  function normalizeShopKey(value) {
    return normalizeSearch(normalizeShop(value)).replace(/[・･\-‐ー―]/g, "");
  }

  function chooseShop(primary, fallback) {
    const candidates = [primary, fallback].filter(Boolean).map(normalizeShop);
    candidates.sort((a, b) => shopQuality(b) - shopQuality(a));
    return candidates[0] || "";
  }

  function shopQuality(shop) {
    if (!shop) return 0;
    let score = Math.min(shop.length, 40);
    if (/主催者|カード|BOOK|TSUTAYA|バトロコ|ドラゴン|Wonder|トレカ|ショップ/i.test(shop)) score += 20;
    if (/^\d+$|プレイヤーID|イベント結果/.test(shop)) score -= 50;
    return score;
  }

  function choosePlayerName(primary, fallback, playerId) {
    return normalizePlayerName(primary, playerId, "") || normalizePlayerName(fallback, playerId, "");
  }

  function normalizePrefecture(value) {
    const text = cleanText(value);
    const found = PREFECTURES.find((prefecture) => text === prefecture || text.includes(prefecture));
    return found || "";
  }

  function normalizeCategory(value) {
    const text = cleanText(value);
    if (/ジュニア/.test(text)) return "ジュニア";
    if (/シニア/.test(text)) return "シニア";
    if (/マスター/.test(text)) return "マスター";
    if (/オープン/.test(text)) return "オープン";
    return text;
  }

  function extractCategory(eventName) {
    return normalizeCategory(eventName);
  }

  function extractSeriesYear(eventName, date) {
    const match = String(eventName || "").match(/シティリーグ\s*(20\d{2})/);
    if (match) return Number(match[1]);
    const dateMatch = String(date || "").match(/^(20\d{2})-(\d{2})/);
    if (!dateMatch) return null;
    const year = Number(dateMatch[1]);
    const month = Number(dateMatch[2]);
    return month >= 9 ? year + 1 : year;
  }

  function extractSeason(eventName) {
    const match = String(eventName || "").match(/シーズン\s*([1-4])/);
    return match ? `シーズン${match[1]}` : "";
  }

  function extractRank(text) {
    const match = String(text || "").match(/(?:^|\s)(\d{1,3})\s*位/);
    return match ? Number(match[1]) : null;
  }

  function normalizeDate(value) {
    const text = cleanText(value);
    const match = text.match(/(20\d{2})[年\/-](\d{1,2})[月\/-](\d{1,2})/);
    if (!match) return "";
    return `${match[1]}-${String(match[2]).padStart(2, "0")}-${String(match[3]).padStart(2, "0")}`;
  }

  function chooseValidDate(a, b) {
    return normalizeDate(a) || normalizeDate(b) || "";
  }

  function chooseLongerMeaningful(a, b) {
    const values = [cleanText(a), cleanText(b)].filter(Boolean);
    values.sort((x, y) => y.length - x.length);
    return values[0] || "";
  }

  function cleanText(value) {
    return String(value ?? "").replace(/\u0000/g, "").trim();
  }

  function normalizeDigits(value) {
    return String(value || "").replace(/\D/g, "");
  }

  function normalizeSearch(value) {
    return String(value || "").normalize("NFKC").toLocaleLowerCase("ja").replace(/\s+/g, " ").trim();
  }

  function parsePositiveInt(value) {
    const match = String(value ?? "").match(/\d+/);
    const number = match ? Number(match[0]) : NaN;
    return Number.isInteger(number) && number > 0 ? number : null;
  }

  function parseNonNegativeNumber(value) {
    const match = String(value ?? "").replace(/,/g, "").match(/-?\d+(?:\.\d+)?/);
    const number = match ? Number(match[0]) : NaN;
    return finite(number) && number >= 0 ? number : null;
  }

  function annualKey(year, category, playerId) {
    return `${year}|${category}|${playerId}`;
  }

  function groupBy(items, keyFn) {
    const map = new Map();
    items.forEach((item) => {
      const key = keyFn(item);
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(item);
    });
    return map;
  }

  function mean(values) {
    const valid = values.filter(finite);
    return valid.length ? valid.reduce((sum, value) => sum + value, 0) / valid.length : 0;
  }

  function weightedMean(pairs) {
    let numerator = 0;
    let denominator = 0;
    pairs.forEach(([value, weight]) => {
      if (!finite(value) || !finite(weight) || weight <= 0) return;
      numerator += value * weight;
      denominator += weight;
    });
    return denominator ? numerator / denominator : 0;
  }

  function weightedStd(pairs, providedMean) {
    const average = finite(providedMean) ? providedMean : weightedMean(pairs);
    let numerator = 0;
    let denominator = 0;
    pairs.forEach(([value, weight]) => {
      if (!finite(value) || !finite(weight) || weight <= 0) return;
      numerator += weight * ((value - average) ** 2);
      denominator += weight;
    });
    return denominator ? Math.sqrt(numerator / denominator) : 0;
  }

  function populationStd(values) {
    const valid = values.filter(finite);
    if (!valid.length) return 0;
    const average = mean(valid);
    return Math.sqrt(mean(valid.map((value) => (value - average) ** 2)));
  }

  function percentile(values, p) {
    const sorted = values.filter(finite).sort((a, b) => a - b);
    if (!sorted.length) return 0;
    const position = (sorted.length - 1) * p;
    const lower = Math.floor(position);
    const upper = Math.ceil(position);
    if (lower === upper) return sorted[lower];
    return sorted[lower] + (sorted[upper] - sorted[lower]) * (position - lower);
  }

  function linearSlope(points) {
    if (points.length < 2) return null;
    const xMean = mean(points.map(([x]) => x));
    const yMean = mean(points.map(([, y]) => y));
    const numerator = points.reduce((sum, [x, y]) => sum + (x - xMean) * (y - yMean), 0);
    const denominator = points.reduce((sum, [x]) => sum + ((x - xMean) ** 2), 0);
    return denominator ? numerator / denominator : 0;
  }

  function compareRows(a, b) {
    return String(b.date).localeCompare(String(a.date)) || Number(a.rank) - Number(b.rank) || a.playerId.localeCompare(b.playerId);
  }

  function dateStamp(value) {
    const stamp = Date.parse(value || "");
    return Number.isNaN(stamp) ? 0 : stamp;
  }

  function uniqueSorted(values, numericDesc = false, customOrder) {
    const unique = [...new Set(values)];
    if (customOrder) return unique.sort(customOrder);
    return unique.sort(numericDesc ? (a, b) => Number(b) - Number(a) : (a, b) => String(a).localeCompare(String(b), "ja"));
  }

  function prefectureOrder(a, b) {
    return PREFECTURES.indexOf(a) - PREFECTURES.indexOf(b);
  }

  function rankModeLabel(mode) {
    if (mode === "top4") return "TOP4固定";
    if (mode === "top8") return "TOP8固定";
    return "ポイント圏すべて";
  }

  function trendLabel(value) {
    if (!finite(value)) return { text: "データ不足", className: "trend-flat" };
    if (value >= 2.5) return { text: `↑ +${formatDecimal(value, 1)}/年`, className: "trend-up" };
    if (value <= -2.5) return { text: `↓ ${formatDecimal(value, 1)}/年`, className: "trend-down" };
    return { text: `→ ${value >= 0 ? "+" : ""}${formatDecimal(value, 1)}/年`, className: "trend-flat" };
  }

  function trustLabel(value) {
    return value === "high" ? "高" : value === "medium" ? "中" : "参考";
  }

  function formatNumber(value) {
    return Number(value || 0).toLocaleString("ja-JP", { maximumFractionDigits: 0 });
  }

  function formatDecimal(value, digits = 1) {
    return Number(value || 0).toLocaleString("ja-JP", { minimumFractionDigits: digits, maximumFractionDigits: digits });
  }

  function formatPercent(value, digits = 1) {
    return `${formatDecimal((value || 0) * 100, digits)}%`;
  }

  function csvEscape(value) {
    const text = String(value ?? "");
    return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  }

  function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>'"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" }[char]));
  }

  function escapeAttr(value) {
    return escapeHtml(value).replace(/`/g, "&#96;");
  }

  // 自動テスト用。通常画面では使用しません。
  window.__CITY_LEAGUE_TEST__ = { parseCsv, normalizeDataset, calculateStrength, state };
})();
