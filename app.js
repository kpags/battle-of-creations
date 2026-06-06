const passwordButtons = Array.from(document.querySelectorAll("[data-toggle-password]"));
const forms = Array.from(document.querySelectorAll("[data-form]"));
const isProtectedPage = Boolean(document.querySelector(".home, [data-card-library], [data-card-creator], [data-lobby], [data-deck-library], [data-deck-creator], [data-battle]"));
const isGuestPage = Boolean(document.querySelector("[data-form='login'], [data-form='register'], [data-form='reset']"));
let currentUser = null;
const CARD_TYPE_LABELS = {
  monster: "Monster",
  spell: "Spell",
  trap: "Trap"
};
const DEFAULT_EFFECT_CAUSE = "When this card is played";
const EFFECT_SPECIAL_LEVEL_RANGE = "special summon a level X to X monster from hand.";
const EFFECT_SEND_GRAVEYARD_TO_DESTINATION = "send a monster/spell/trap card from graveyard to hand/deck.";
const EFFECT_SPECIAL_LEVEL_FOUR_FROM_SOURCE = "special summon 1-2 level 4 or below monsters from hand/deck.";
const DEFAULT_EFFECT_TEMPLATE = EFFECT_SPECIAL_LEVEL_RANGE;
const DEFAULT_EFFECT_OUTCOME = "special summon a level 1 to 4 monster from hand.";

function combineEffectStatements(cause, effect) {
  const causeText = String(cause || "").trim();
  const effectText = String(effect || "").trim();

  if (!causeText && !effectText) {
    return "";
  }

  if (!causeText) {
    return effectText;
  }

  if (!effectText) {
    return causeText;
  }

  const separator = /[.;:!?]$/.test(causeText) ? " " : "; ";
  return `${causeText}${separator}${effectText}`;
}

function clampEffectLevel(value, fallback = 1) {
  const number = Number.parseInt(value, 10);

  if (Number.isNaN(number)) {
    return fallback;
  }

  return Math.min(Math.max(number, 1), 10);
}

function normalizeHandDeckChoice(value, fallback = "hand") {
  const choice = String(value || "").toLowerCase();
  return choice === "deck" ? "deck" : fallback;
}

function effectTemplateFromOutcome(outcome) {
  const text = String(outcome || "").trim();

  if (!text) {
    return DEFAULT_EFFECT_TEMPLATE;
  }

  if (/^special summon a level \d+ to \d+ monster from hand\.$/i.test(text)) {
    return EFFECT_SPECIAL_LEVEL_RANGE;
  }

  if (/^send a monster\/spell\/trap card from graveyard to (hand|deck)\.$/i.test(text)) {
    return EFFECT_SEND_GRAVEYARD_TO_DESTINATION;
  }

  if (/^special summon 1-2 level 4 or below monsters from (hand|deck)\.$/i.test(text)) {
    return EFFECT_SPECIAL_LEVEL_FOUR_FROM_SOURCE;
  }

  return text;
}

function effectParamsFromCard(card) {
  const params = {
    ...(card?.effectParams && typeof card.effectParams === "object" ? card.effectParams : {})
  };
  const outcome = String(card?.effectOutcome || "");
  const levelRange = outcome.match(/^special summon a level (\d+) to (\d+) monster from hand\.$/i);
  const graveyardDestination = outcome.match(/^send a monster\/spell\/trap card from graveyard to (hand|deck)\.$/i);
  const summonSource = outcome.match(/^special summon 1-2 level 4 or below monsters from (hand|deck)\.$/i);

  if (levelRange) {
    params.levelFrom = params.levelFrom || levelRange[1];
    params.levelTo = params.levelTo || levelRange[2];
  }

  if (graveyardDestination) {
    params.destination = params.destination || graveyardDestination[1].toLowerCase();
  }

  if (summonSource) {
    params.source = params.source || summonSource[1].toLowerCase();
  }

  return params;
}

function cardEffectTemplate(card) {
  return String(card?.effectTemplate || card?.effectOutcomeTemplate || effectTemplateFromOutcome(card?.effectOutcome));
}

function buildEffectOutcome(template, params = {}) {
  const effectTemplate = String(template || DEFAULT_EFFECT_TEMPLATE);

  if (effectTemplate === EFFECT_SPECIAL_LEVEL_RANGE) {
    const firstLevel = Math.min(clampEffectLevel(params.levelFrom, 1), 4);
    const secondLevel = Math.min(clampEffectLevel(params.levelTo, 4), 4);
    const fromLevel = Math.min(firstLevel, secondLevel);
    const toLevel = Math.max(firstLevel, secondLevel);
    return `special summon a level ${fromLevel} to ${toLevel} monster from hand.`;
  }

  if (effectTemplate === EFFECT_SEND_GRAVEYARD_TO_DESTINATION) {
    return `send a monster/spell/trap card from graveyard to ${normalizeHandDeckChoice(params.destination)}.`;
  }

  if (effectTemplate === EFFECT_SPECIAL_LEVEL_FOUR_FROM_SOURCE) {
    return `special summon 1-2 level 4 or below monsters from ${normalizeHandDeckChoice(params.source)}.`;
  }

  return effectTemplate || DEFAULT_EFFECT_OUTCOME;
}

function cardEffectOutcome(card) {
  return buildEffectOutcome(cardEffectTemplate(card), effectParamsFromCard(card));
}

function cardEffectDescription(card) {
  return String(
    combineEffectStatements(card?.effectCause, cardEffectOutcome(card)) ||
    card?.effectDescription ||
    "No effect description has been written for this card yet."
  );
}

function normalizeEmail(email) {
  return String(email || "").trim().toLowerCase();
}

function createId(prefix) {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function getCurrentUser() {
  return currentUser;
}

async function apiRequest(path, options = {}) {
  const hasBody = Object.prototype.hasOwnProperty.call(options, "body");
  const response = await fetch(path, {
    method: options.method || (hasBody ? "POST" : "GET"),
    credentials: "same-origin",
    headers: hasBody ? { "Content-Type": "application/json" } : undefined,
    body: hasBody ? JSON.stringify(options.body) : undefined
  });
  const rawText = await response.text();
  let payload = {};

  if (rawText) {
    try {
      payload = JSON.parse(rawText);
    } catch {
      payload = { error: rawText };
    }
  }

  if (!response.ok) {
    throw new Error(payload.error || payload.message || "Request failed.");
  }

  return payload;
}

async function apiFileRequest(path, file) {
  if (!file) {
    throw new Error("Choose a JSON file to import.");
  }
  if (file.size > 256 * 1024 * 1024) {
    throw new Error("The import file is larger than the 256 MB limit.");
  }

  const response = await fetch(path, {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: file
  });
  const rawText = await response.text();
  let payload = {};

  if (rawText) {
    try {
      payload = JSON.parse(rawText);
    } catch {
      payload = { error: rawText };
    }
  }

  if (!response.ok) {
    throw new Error(payload.error || payload.message || "File upload failed.");
  }

  return payload;
}

async function refreshSession() {
  try {
    const payload = await apiRequest("/api/session");
    currentUser = payload.user || null;
    return currentUser;
  } catch {
    currentUser = null;
    return null;
  }
}

async function logout() {
  try {
    await apiRequest("/api/logout", { method: "POST" });
  } finally {
    currentUser = null;
  }
}

async function getMyCards() {
  const payload = await apiRequest("/api/cards");
  return payload.cards || [];
}

async function getMyDecks() {
  const payload = await apiRequest("/api/decks");
  return payload.decks || [];
}

async function getLibrary() {
  const payload = await apiRequest("/api/library");
  return {
    cards: payload.cards || [],
    decks: payload.decks || []
  };
}

async function importCardsPackage(file) {
  return apiFileRequest("/api/import/cards", file);
}

async function importDecksPackage(file) {
  return apiFileRequest("/api/import/decks", file);
}

async function getBackgroundTask(id) {
  const payload = await apiRequest(`/api/tasks/${encodeURIComponent(id)}`);
  return payload.task || null;
}

async function saveCard(card) {
  const payload = await apiRequest("/api/cards", {
    method: "POST",
    body: card
  });
  return payload.card;
}

async function saveDeck(deck) {
  const payload = await apiRequest("/api/decks", {
    method: "POST",
    body: deck
  });
  return payload.deck;
}

async function deleteCards(ids) {
  const payload = await apiRequest("/api/cards", {
    method: "DELETE",
    body: { ids }
  });
  return payload;
}

async function deleteDecks(ids) {
  const payload = await apiRequest("/api/decks", {
    method: "DELETE",
    body: { ids }
  });
  return payload;
}

window.BattleOfCreationsStore = {
  getCurrentUser,
  refreshSession,
  getMyCards,
  getMyDecks,
  getLibrary,
  importCardsPackage,
  importDecksPackage,
  getBackgroundTask,
  saveCard,
  saveDeck,
  deleteCards,
  deleteDecks
};

function startServerDownload(path) {
  const link = document.createElement("a");
  link.href = path;
  link.hidden = true;
  document.body.appendChild(link);
  link.click();
  link.remove();
}

const BACKGROUND_TASK_STORAGE_KEY = "boc-background-tasks-v1";

function readTrackedBackgroundTasks() {
  try {
    const tasks = JSON.parse(localStorage.getItem(BACKGROUND_TASK_STORAGE_KEY) || "[]");
    return Array.isArray(tasks) ? tasks.filter((task) => task?.id) : [];
  } catch {
    return [];
  }
}

function writeTrackedBackgroundTasks(tasks) {
  localStorage.setItem(BACKGROUND_TASK_STORAGE_KEY, JSON.stringify(tasks));
}

function trackBackgroundTask(task) {
  if (!task?.id) return;
  const tracked = readTrackedBackgroundTasks().filter((item) => item.id !== task.id);
  tracked.push({
    id: task.id,
    kind: task.kind || "import",
    label: task.label || "Import",
    createdAt: task.createdAt || new Date().toISOString()
  });
  writeTrackedBackgroundTasks(tracked.slice(-10));
}

function untrackBackgroundTask(taskId) {
  writeTrackedBackgroundTasks(
    readTrackedBackgroundTasks().filter((task) => task.id !== taskId)
  );
}

function backgroundTaskMessage(task) {
  const progress = Number(task?.progress);
  const suffix = Number.isFinite(progress) && progress > 0 && progress < 100
    ? ` (${progress}%)`
    : "";
  return `${task?.message || task?.label || "Background task"}${suffix}`;
}

function showGlobalTaskStatus(text, isError = false, autoHide = false) {
  let element = document.querySelector("[data-global-task-status]");
  if (!element) {
    element = document.createElement("div");
    element.className = "global-task-status";
    element.dataset.globalTaskStatus = "";
    element.setAttribute("role", "status");
    element.setAttribute("aria-live", "polite");
    document.body.appendChild(element);
  }

  element.textContent = text;
  element.classList.toggle("is-error", isError);
  element.classList.add("is-visible");
  window.clearTimeout(showGlobalTaskStatus.hideTimer);

  if (autoHide) {
    showGlobalTaskStatus.hideTimer = window.setTimeout(() => {
      element.classList.remove("is-visible");
    }, 6000);
  }
}

function delay(milliseconds) {
  return new Promise((resolve) => window.setTimeout(resolve, milliseconds));
}

async function waitForBackgroundTask(initialTask, onUpdate = () => {}, announceCompletion = true) {
  if (!initialTask?.id) {
    throw new Error("The server did not create a background import task.");
  }

  let task = initialTask;
  trackBackgroundTask(task);
  onUpdate(task);

  while (task && ["queued", "running"].includes(task.status)) {
    await delay(750);
    task = await window.BattleOfCreationsStore.getBackgroundTask(task.id);
    if (!task) {
      throw new Error("The background import could not be found.");
    }
    onUpdate(task);
  }

  untrackBackgroundTask(initialTask.id);

  if (task?.status === "failed") {
    throw new Error(task.message || "The background import failed.");
  }

  if (announceCompletion) {
    document.dispatchEvent(new CustomEvent("boc:background-task-complete", {
      detail: task
    }));
  }
  return task;
}

async function resumeBackgroundTasks() {
  const tracked = readTrackedBackgroundTasks();

  tracked.forEach(async (savedTask) => {
    try {
      const task = await window.BattleOfCreationsStore.getBackgroundTask(savedTask.id);
      if (!task) {
        untrackBackgroundTask(savedTask.id);
        return;
      }

      const completed = await waitForBackgroundTask(task, (current) => {
        showGlobalTaskStatus(backgroundTaskMessage(current));
      });
      showGlobalTaskStatus(backgroundTaskMessage(completed), false, true);
    } catch (error) {
      untrackBackgroundTask(savedTask.id);
      showGlobalTaskStatus(error.message || "A background import failed.", true, true);
    }
  });
}

function updateTransferStatus(element, text, isError = false) {
  if (!element) return;
  element.textContent = text;
  element.hidden = !text;
  element.classList.toggle("is-error", isError);
}

function yieldToBrowser() {
  return new Promise((resolve) => window.requestAnimationFrame(() => resolve()));
}

function showFormMessage(form, text, isError = false) {
  const message = form.querySelector(".form-message");
  if (!message) {
    return;
  }

  message.textContent = text;
  message.classList.toggle("is-error", isError);
}

function hydrateCurrentUserUI() {
  const user = currentUser;
  if (!user) {
    return;
  }

  document.querySelectorAll("[data-player-username]").forEach((element) => {
    element.textContent = user.username;
  });
  document.querySelectorAll("[data-player-level]").forEach((element) => {
    element.textContent = `Level ${user.level}`;
  });
  document.querySelectorAll("[data-player-xp]").forEach((element) => {
    element.textContent = `${user.xp} / ${user.xpMax}`;
  });
  document.querySelectorAll("[data-player-gold]").forEach((element) => {
    element.textContent = Number(user.gold).toLocaleString();
  });
  document.querySelectorAll("[data-player-xp-track]").forEach((element) => {
    const percent = Math.max(0, Math.min((user.xp / user.xpMax) * 100, 100));
    element.style.width = `${percent}%`;
  });
}

const sessionReady = refreshSession().then((user) => {
  if (isProtectedPage && !user) {
    window.location.href = "index.html";
    return null;
  }

  if (isGuestPage && user) {
    window.location.href = "home.html";
    return null;
  }

  hydrateCurrentUserUI();
  return user;
});

sessionReady.then((user) => {
  if (user) {
    resumeBackgroundTasks();
  }
});

document.querySelectorAll("[data-logout]").forEach((link) => {
  link.addEventListener("click", async (event) => {
    event.preventDefault();
    const target = link.getAttribute("href") || "index.html";
    await logout();
    window.location.href = target;
  });
});

passwordButtons.forEach((button) => {
  button.addEventListener("click", () => {
    const input = button.closest(".input-shell")?.querySelector("input");

    if (!input) {
      return;
    }

    const shouldShow = input.type === "password";
    input.type = shouldShow ? "text" : "password";
    button.setAttribute("aria-label", shouldShow ? "Hide password" : "Show password");
  });
});

forms.forEach((form) => {
  form.addEventListener("submit", async (event) => {
    event.preventDefault();

    const formName = form.dataset.form;
    const password = form.querySelector('input[name="new-password"]');
    const confirm = form.querySelector('input[name="confirm-password"]');
    const submitButton = form.querySelector('button[type="submit"]');

    showFormMessage(form, "");

    if (password && confirm && password.value !== confirm.value) {
      showFormMessage(form, "Passwords do not match.", true);
      confirm.focus();
      return;
    }

    submitButton?.setAttribute("disabled", "");
    form.setAttribute("aria-busy", "true");

    try {
      if (formName === "login") {
        const payload = await apiRequest("/api/login", {
          method: "POST",
          body: {
            email: normalizeEmail(form.elements.email?.value),
            password: form.elements.password?.value || ""
          }
        });

        currentUser = payload.user || null;
        showFormMessage(form, "Entering the arena...");
        window.location.href = "home.html";
        return;
      }

      if (formName === "register") {
        const username = String(form.elements.username?.value || "").trim();
        const enteredPassword = form.elements.password?.value || "";

        if (username.length < 6) {
          showFormMessage(form, "Username must be at least 6 characters.", true);
          return;
        }

        if (enteredPassword.length < 6) {
          showFormMessage(form, "Password must be at least 6 characters.", true);
          return;
        }

        const payload = await apiRequest("/api/register", {
          method: "POST",
          body: {
            username,
            email: normalizeEmail(form.elements.email?.value),
            password: enteredPassword
          }
        });

        currentUser = payload.user || null;
        showFormMessage(form, "Account created. Entering the arena...");
        window.location.href = "home.html";
        return;
      }

      if (formName === "reset") {
        const newPassword = form.elements["new-password"]?.value || "";

        if (newPassword.length < 6) {
          showFormMessage(form, "Password must be at least 6 characters.", true);
          return;
        }

        await apiRequest("/api/reset-password", {
          method: "POST",
          body: {
            email: normalizeEmail(form.elements.email?.value),
            newPassword
          }
        });
        currentUser = null;
        showFormMessage(form, "Password reset. You can log in now.");
        window.setTimeout(() => {
          window.location.href = "index.html";
        }, 700);
        return;
      }

      showFormMessage(form, "Request ready.");
    } catch (error) {
      showFormMessage(form, error.message || "The server could not process the request.", true);
    } finally {
      submitButton?.removeAttribute("disabled");
      form.removeAttribute("aria-busy");
    }
  });
});

const cardLibrary = document.querySelector("[data-card-library]");

if (cardLibrary) {
  const PAGE_SIZE = 50;
  const grid = cardLibrary.querySelector("[data-card-grid]");
  const countLabel = cardLibrary.querySelector("[data-card-count]");
  const searchInput = cardLibrary.querySelector("[data-card-search]");
  const typeFilter = cardLibrary.querySelector("[data-card-type-filter]");
  const sortSelect = cardLibrary.querySelector("[data-card-sort]");
  const pagination = cardLibrary.querySelector("[data-card-pagination]");
  const detailPane = cardLibrary.querySelector("[data-detail-pane]");
  const editLink = cardLibrary.querySelector("[data-edit-card]");
  const deleteModeButton = cardLibrary.querySelector("[data-delete-mode]");
  const deleteStrip = cardLibrary.querySelector("[data-delete-strip]");
  const selectedCount = cardLibrary.querySelector("[data-delete-selected-count]");
  const confirmDeleteButton = cardLibrary.querySelector("[data-confirm-delete]");
  const cancelDeleteButton = cardLibrary.querySelector("[data-cancel-delete]");
  const deleteDialog = cardLibrary.querySelector("[data-delete-dialog]");
  const deleteDialogCount = cardLibrary.querySelector("[data-delete-dialog-count]");
  const cancelConfirmDeleteButton = cardLibrary.querySelector("[data-cancel-confirm-delete]");
  const runDeleteButton = cardLibrary.querySelector("[data-run-delete]");
  const exportCardsButton = cardLibrary.querySelector("[data-export-cards]");
  const importCardsButton = cardLibrary.querySelector("[data-import-cards]");
  const importCardsInput = cardLibrary.querySelector("[data-import-cards-file]");
  const transferStatus = cardLibrary.querySelector("[data-transfer-status]");
  const initiallySelectedCardId = new URLSearchParams(window.location.search).get("card") || "";
  let allCards = [];
  let currentPage = 1;
  let selectedCardId = initiallySelectedCardId;
  let deleteMode = false;
  let selectedDeleteIds = new Set();

  function clampCardLevel(level) {
    const number = Number.parseInt(level, 10);
    if (Number.isNaN(number)) {
      return 1;
    }

    return Math.min(Math.max(number, 1), 10);
  }

  function cardType(card) {
    return ["monster", "spell", "trap"].includes(card.cardType) ? card.cardType : "monster";
  }

  function monsterType(card) {
    return card.monsterType || "Effect";
  }

  function isEffectMonster(card) {
    return cardType(card) === "monster" && monsterType(card).toLowerCase() === "effect";
  }

  function isNormalMonster(card) {
    return cardType(card) === "monster" && monsterType(card).toLowerCase() === "normal";
  }

  function cardName(card) {
    return String(card.cardName || "Unnamed Creation");
  }

  function cardDescription(card) {
    if (isEffectMonster(card)) {
      return cardEffectDescription(card);
    }

    if (isNormalMonster(card)) {
      return String(card.shortDescription || "No short description has been written for this card yet.");
    }

    if (cardType(card) === "spell") {
      return String(card.spellEffectDescription || "No effect has been selected for this spell card.");
    }

    if (cardType(card) === "trap") {
      return String(card.trapEffectDescription || "No effect has been selected for this trap card.");
    }

    return cardEffectDescription(card);
  }

  function cardCreatedAt(card) {
    const dateValue = card.savedAt || card.createdAt || card.updatedAt;
    const date = dateValue ? new Date(dateValue) : null;

    if (!date || Number.isNaN(date.getTime())) {
      return "Unknown";
    }

    return date.toLocaleString([], {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit"
    });
  }

  function cardPosition(card) {
    return {
      x: Number(card.imagePosition?.x) || 50,
      y: Number(card.imagePosition?.y) || 50
    };
  }

  function renderLevelDiamonds(container, level) {
    container.textContent = "";
    const count = clampCardLevel(level);

    for (let index = 0; index < count; index += 1) {
      container.append(document.createElement("span"));
    }
  }

  function createArtElement(className, card) {
    const position = cardPosition(card);
    const art = document.createElement("div");
    const image = document.createElement("img");
    const beast = document.createElement("span");

    art.className = `${className} art-underworld`;
    art.style.setProperty("--art-x", `${position.x}%`);
    art.style.setProperty("--art-y", `${position.y}%`);
    image.className = "uploaded-art";
    image.alt = "";
    beast.className = "art-beast";
    beast.setAttribute("aria-hidden", "true");

    if (card.uploadedImage) {
      art.classList.add("has-upload");
      image.src = card.uploadedImage;
    }

    art.append(image, beast);
    return art;
  }

  function createPreviewCard(card) {
    const type = cardType(card);
    const preview = document.createElement("article");
    const cornerOne = document.createElement("div");
    const cornerTwo = document.createElement("div");
    const titleBar = document.createElement("header");
    const title = document.createElement("h2");
    const attribute = document.createElement("span");
    const meta = document.createElement("div");
    const levelWrap = document.createElement("div");
    const levelLabel = document.createElement("span");
    const levelDiamonds = document.createElement("div");
    const kindWrap = document.createElement("div");
    const kindLabel = document.createElement("span");
    const kindValue = document.createElement("strong");
    const description = document.createElement("section");
    const descriptionTitle = document.createElement("h3");
    const descriptionText = document.createElement("p");
    const stats = document.createElement("footer");
    const attack = document.createElement("strong");
    const attackIcon = document.createElement("img");
    const attackText = document.createElement("span");
    const defense = document.createElement("strong");
    const defenseIcon = document.createElement("img");
    const defenseText = document.createElement("span");

    preview.className = `battle-card-preview library-preview-card card-kind-${type}`;
    cornerOne.className = "card-frame-corner corner-one";
    cornerOne.setAttribute("aria-hidden", "true");
    cornerTwo.className = "card-frame-corner corner-two";
    cornerTwo.setAttribute("aria-hidden", "true");

    titleBar.className = "preview-titlebar";
    title.textContent = cardName(card);
    attribute.className = "preview-attribute";
    attribute.setAttribute("aria-label", `${CARD_TYPE_LABELS[type]} attribute`);
    titleBar.append(title, attribute);

    meta.className = "preview-meta";
    levelWrap.className = "preview-level";
    levelLabel.textContent = "Level";
    levelDiamonds.className = "preview-stars";
    levelDiamonds.setAttribute("aria-label", `Level ${clampCardLevel(card.level)}`);
    renderLevelDiamonds(levelDiamonds, card.level);
    levelWrap.append(levelLabel, levelDiamonds);

    kindWrap.className = "preview-kind";
    kindLabel.textContent = "Type";
    kindValue.textContent = type === "monster" ? monsterType(card) : CARD_TYPE_LABELS[type];
    kindWrap.append(kindLabel, kindValue);
    meta.append(levelWrap, kindWrap);

    description.className = "preview-description";
    descriptionTitle.textContent = type === "monster" ? `Monster / ${monsterType(card)}` : `${CARD_TYPE_LABELS[type]} Card`;
    descriptionText.textContent = cardDescription(card);
    description.append(descriptionTitle, descriptionText);

    stats.className = "preview-stats";
    attack.className = "preview-stat preview-attack";
    attackIcon.src = "assets/icons/atk_points_icon.png";
    attackIcon.alt = "";
    attackIcon.setAttribute("aria-hidden", "true");
    attackText.textContent = String(card.attack ?? 0);
    attack.append(attackIcon, attackText);

    defense.className = "preview-stat preview-defense";
    defenseIcon.src = "assets/icons/def_points_icon.png";
    defenseIcon.alt = "";
    defenseIcon.setAttribute("aria-hidden", "true");
    defenseText.textContent = String(card.defense ?? 0);
    defense.append(defenseIcon, defenseText);
    stats.append(attack, defense);

    if (type !== "monster") {
      meta.hidden = true;
      stats.hidden = true;
    }

    preview.append(
      cornerOne,
      cornerTwo,
      titleBar,
      createArtElement("preview-art", card),
      meta,
      description,
      stats
    );

    return preview;
  }

  function createMiniCard(card) {
    const type = cardType(card);
    const article = document.createElement("article");
    const selector = document.createElement("label");
    const checkbox = document.createElement("input");
    const selectorMark = document.createElement("span");
    const button = document.createElement("button");
    const title = document.createElement("strong");
    const level = document.createElement("div");
    const stats = document.createElement("div");
    const attack = document.createElement("span");
    const attackIcon = document.createElement("img");
    const defense = document.createElement("span");
    const defenseIcon = document.createElement("img");

    article.className = `library-card-mini card-kind-${type}`;
    article.dataset.cardId = card.id;
    article.classList.toggle("is-selected", card.id === selectedCardId);
    article.classList.toggle("is-delete-selected", selectedDeleteIds.has(card.id));

    selector.className = "card-select-bubble";
    checkbox.type = "checkbox";
    checkbox.checked = selectedDeleteIds.has(card.id);
    checkbox.setAttribute("aria-label", `Select ${cardName(card)} for deletion`);
    checkbox.addEventListener("change", () => {
      if (checkbox.checked) {
        selectedDeleteIds.add(card.id);
      } else {
        selectedDeleteIds.delete(card.id);
      }
      renderCards();
    });
    selector.append(checkbox, selectorMark);

    button.className = "library-card-button";
    button.type = "button";
    button.addEventListener("click", () => {
      selectedCardId = card.id;
      renderDetail();
      renderCards();
    });

    title.className = "mini-card-title";
    title.textContent = cardName(card);
    level.className = "mini-card-level preview-stars";
    level.setAttribute("aria-label", `Level ${clampCardLevel(card.level)}`);
    renderLevelDiamonds(level, card.level);

    stats.className = "mini-card-stats";
    attackIcon.src = "assets/icons/atk_points_icon.png";
    attackIcon.alt = "";
    attackIcon.setAttribute("aria-hidden", "true");
    attack.append(attackIcon, document.createTextNode(String(card.attack ?? 0)));
    defenseIcon.src = "assets/icons/def_points_icon.png";
    defenseIcon.alt = "";
    defenseIcon.setAttribute("aria-hidden", "true");
    defense.append(defenseIcon, document.createTextNode(String(card.defense ?? 0)));
    stats.append(attack, defense);

    const miniCardChildren = [title, createArtElement("mini-card-art", card)];
    if (type === "monster") {
      miniCardChildren.push(level, stats);
    } else {
      const typeTag = document.createElement("span");
      typeTag.className = "mini-card-type-tag";
      typeTag.textContent = type === "spell" ? "Spell Card" : "Trap Card";
      miniCardChildren.push(typeTag);
    }
    button.append(...miniCardChildren);
    article.append(selector, button);
    return article;
  }

  function filteredCards() {
    const query = String(searchInput?.value || "").trim().toLowerCase();
    const type = typeFilter?.value || "all";
    const sortBy = sortSelect?.value || "newest";
    const cards = allCards.filter((card) => {
      const matchesType = type === "all" || cardType(card) === type;
      const haystack = [
        cardName(card),
        monsterType(card),
        card.effect,
        card.effectCause,
        card.effectTemplate,
        card.effectOutcome,
        cardEffectOutcome(card),
        cardDescription(card)
      ].join(" ").toLowerCase();

      return matchesType && (!query || haystack.includes(query));
    });

    cards.sort((first, second) => {
      if (sortBy === "oldest") {
        return Date.parse(first.savedAt || first.createdAt || 0) - Date.parse(second.savedAt || second.createdAt || 0);
      }

      if (sortBy === "name") {
        return cardName(first).localeCompare(cardName(second));
      }

      if (sortBy === "level") {
        return clampCardLevel(second.level) - clampCardLevel(first.level);
      }

      return Date.parse(second.savedAt || second.createdAt || 0) - Date.parse(first.savedAt || first.createdAt || 0);
    });

    return cards;
  }

  function updateDeleteControls() {
    cardLibrary.classList.toggle("is-delete-mode", deleteMode);

    if (deleteModeButton) {
      deleteModeButton.classList.toggle("is-active", deleteMode);
    }

    if (deleteStrip) {
      deleteStrip.hidden = !deleteMode;
    }

    if (selectedCount) {
      selectedCount.textContent = `${selectedDeleteIds.size} selected`;
    }

    if (confirmDeleteButton) {
      confirmDeleteButton.disabled = selectedDeleteIds.size === 0;
    }
  }

  function renderPagination(totalCards) {
    if (!pagination) {
      return;
    }

    pagination.textContent = "";
    const pageCount = Math.max(1, Math.ceil(totalCards / PAGE_SIZE));
    currentPage = Math.min(Math.max(currentPage, 1), pageCount);

    function addPageButton(label, page, isCurrent = false, disabled = false) {
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = label;
      button.disabled = disabled;
      button.classList.toggle("is-current", isCurrent);
      button.addEventListener("click", () => {
        currentPage = page;
        renderCards();
      });
      pagination.append(button);
    }

    addPageButton("<<", Math.max(currentPage - 1, 1), false, currentPage === 1);

    const start = Math.max(1, currentPage - 2);
    const end = Math.min(pageCount, currentPage + 2);

    if (start > 1) {
      addPageButton("1", 1, currentPage === 1);
      if (start > 2) {
        const ellipsis = document.createElement("span");
        ellipsis.textContent = "...";
        pagination.append(ellipsis);
      }
    }

    for (let page = start; page <= end; page += 1) {
      addPageButton(String(page), page, page === currentPage);
    }

    if (end < pageCount) {
      if (end < pageCount - 1) {
        const ellipsis = document.createElement("span");
        ellipsis.textContent = "...";
        pagination.append(ellipsis);
      }
      addPageButton(String(pageCount), pageCount, currentPage === pageCount);
    }

    addPageButton(">>", Math.min(currentPage + 1, pageCount), false, currentPage === pageCount);
  }

  function renderCards() {
    if (!grid) {
      return;
    }

    const cards = filteredCards();
    const pageCount = Math.max(1, Math.ceil(cards.length / PAGE_SIZE));
    currentPage = Math.min(Math.max(currentPage, 1), pageCount);
    const start = (currentPage - 1) * PAGE_SIZE;
    const pageCards = cards.slice(start, start + PAGE_SIZE);

    grid.textContent = "";
    pageCards.forEach((card) => grid.append(createMiniCard(card)));

    if (pageCards.length === 0) {
      const empty = document.createElement("div");
      empty.className = "library-empty-state";
      empty.textContent = allCards.length === 0 ? "No cards created yet." : "No cards match the current filters.";
      grid.append(empty);
    }

    if (countLabel) {
      if (cards.length === 0) {
        countLabel.textContent = allCards.length === 0 ? "0 cards created" : "0 cards found";
      } else {
        countLabel.textContent = `Showing ${start + 1}-${start + pageCards.length} of ${cards.length} cards`;
      }
    }

    renderPagination(cards.length);
    updateDeleteControls();
  }

  function renderDetail() {
    if (!detailPane) {
      return;
    }

    const selectedCard = allCards.find((card) => card.id === selectedCardId);
    detailPane.textContent = "";

    if (!selectedCard) {
      if (editLink) {
        editLink.hidden = true;
        editLink.href = "#";
      }
      return;
    }

    if (editLink) {
      editLink.hidden = false;
      editLink.href = `card-creator.html?card=${encodeURIComponent(selectedCard.id)}`;
    }

    const facts = document.createElement("dl");
    const selectedType = cardType(selectedCard);
    const rows = [["Card Type", CARD_TYPE_LABELS[selectedType]]];

    if (selectedType === "monster") {
      rows.push(
        ["Monster Type", monsterType(selectedCard)],
        ["Level", String(clampCardLevel(selectedCard.level))],
        ["Attack Points", String(selectedCard.attack ?? 0)],
        ["Defense Points", String(selectedCard.defense ?? 0)]
      );
    }

    if (isEffectMonster(selectedCard)) {
      rows.push(
        ["Short Effect Description", cardEffectDescription(selectedCard)]
      );
    } else if (isNormalMonster(selectedCard)) {
      rows.push(["Short Description", selectedCard.shortDescription || "None"]);
    } else if (selectedType === "spell") {
      rows.push(
        ["Effect", selectedCard.spellEffectLabel || selectedCard.spellEffect || "None"],
        ["Effect Description", selectedCard.spellEffectDescription || "None"]
      );
    } else if (selectedType === "trap") {
      rows.push(
        ["Effect", selectedCard.trapEffectLabel || selectedCard.trapEffect || "None"],
        ["Effect Description", selectedCard.trapEffectDescription || "None"]
      );
    }

    rows.push(["Created On", cardCreatedAt(selectedCard)]);

    facts.className = "library-card-facts";
    rows.forEach(([label, value]) => {
      const term = document.createElement("dt");
      const description = document.createElement("dd");
      term.textContent = label;
      description.textContent = value;
      facts.append(term, description);
    });

    detailPane.append(createPreviewCard(selectedCard), facts);
  }

  function setDeleteMode(enabled) {
    deleteMode = enabled;
    if (!deleteMode) {
      selectedDeleteIds = new Set();
    }
    renderCards();
  }

  function openDeleteDialog() {
    if (!deleteDialog || selectedDeleteIds.size === 0) {
      return;
    }

    if (deleteDialogCount) {
      deleteDialogCount.textContent = `${selectedDeleteIds.size} card${selectedDeleteIds.size === 1 ? "" : "s"} will be permanently deleted.`;
    }

    deleteDialog.hidden = false;
    runDeleteButton?.focus();
  }

  function closeDeleteDialog() {
    if (deleteDialog) {
      deleteDialog.hidden = true;
    }
  }

  async function runBulkDelete() {
    if (selectedDeleteIds.size === 0) {
      closeDeleteDialog();
      return;
    }

    const ids = [...selectedDeleteIds];
    runDeleteButton?.setAttribute("disabled", "");

    try {
      const result = await window.BattleOfCreationsStore.deleteCards(ids);
      const deletedIds = new Set(result.deletedIds || ids);
      allCards = allCards.filter((card) => !deletedIds.has(card.id));

      if (deletedIds.has(selectedCardId)) {
        selectedCardId = "";
      }

      selectedDeleteIds = new Set();
      deleteMode = false;
      closeDeleteDialog();
      renderDetail();
      renderCards();
    } finally {
      runDeleteButton?.removeAttribute("disabled");
    }
  }

  async function loadLibraryCards() {
    const user = await sessionReady;
    if (!user) {
      return;
    }

    try {
      allCards = await window.BattleOfCreationsStore.getMyCards();
      if (selectedCardId && !allCards.some((card) => card.id === selectedCardId)) {
        selectedCardId = "";
      }
      renderDetail();
      renderCards();
    } catch (error) {
      if (countLabel) {
        countLabel.textContent = error.message || "Cards could not be loaded.";
      }
    }
  }

  async function exportCards() {
    if (allCards.length === 0) {
      updateTransferStatus(transferStatus, "There are no cards to export.", true);
      return;
    }

    try {
      startServerDownload("/api/export/cards");
      updateTransferStatus(
        transferStatus,
        `Export started for ${allCards.length} card${allCards.length === 1 ? "" : "s"}. The download can continue while you use another page.`
      );
    } catch (error) {
      updateTransferStatus(transferStatus, error.message || "Cards could not be exported.", true);
    }
  }

  async function importCards(event) {
    const file = event.target.files?.[0];
    if (!file) return;

    exportCardsButton?.setAttribute("disabled", "");
    importCardsButton?.setAttribute("disabled", "");
    updateTransferStatus(transferStatus, `Importing ${file.name}...`);
    await yieldToBrowser();

    try {
      const response = await window.BattleOfCreationsStore.importCardsPackage(file);
      const completedTask = await waitForBackgroundTask(response.task, (task) => {
        updateTransferStatus(transferStatus, backgroundTaskMessage(task));
      }, false);
      const result = completedTask.result || {};
      await loadLibraryCards();
      updateTransferStatus(
        transferStatus,
        `${result.importedCount || 0} card${result.importedCount === 1 ? "" : "s"} imported.`
      );
    } catch (error) {
      updateTransferStatus(transferStatus, error.message || "Cards could not be imported.", true);
    } finally {
      event.target.value = "";
      exportCardsButton?.removeAttribute("disabled");
      importCardsButton?.removeAttribute("disabled");
    }
  }

  searchInput?.addEventListener("input", () => {
    currentPage = 1;
    renderCards();
  });
  typeFilter?.addEventListener("change", () => {
    currentPage = 1;
    renderCards();
  });
  sortSelect?.addEventListener("change", () => {
    currentPage = 1;
    renderCards();
  });
  deleteModeButton?.addEventListener("click", () => setDeleteMode(!deleteMode));
  cancelDeleteButton?.addEventListener("click", () => setDeleteMode(false));
  confirmDeleteButton?.addEventListener("click", openDeleteDialog);
  cancelConfirmDeleteButton?.addEventListener("click", closeDeleteDialog);
  runDeleteButton?.addEventListener("click", runBulkDelete);
  exportCardsButton?.addEventListener("click", exportCards);
  importCardsButton?.addEventListener("click", () => importCardsInput?.click());
  importCardsInput?.addEventListener("change", importCards);
  document.addEventListener("boc:background-task-complete", (event) => {
    if (event.detail?.kind === "cards-import") {
      loadLibraryCards();
    }
  });
  deleteDialog?.addEventListener("click", (event) => {
    if (event.target === deleteDialog) {
      closeDeleteDialog();
    }
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      closeDeleteDialog();
    }
  });

  loadLibraryCards();
}

const deckLibrary = document.querySelector("[data-deck-library]");

if (deckLibrary) {
  const DECK_PAGE_SIZE = 50;
  const deckGrid = deckLibrary.querySelector("[data-deck-grid]");
  const deckCountLabel = deckLibrary.querySelector("[data-deck-count]");
  const deckSearchInput = deckLibrary.querySelector("[data-deck-search]");
  const deckSortSelect = deckLibrary.querySelector("[data-deck-sort]");
  const deckPagination = deckLibrary.querySelector("[data-deck-pagination]");
  const deckDetailPane = deckLibrary.querySelector("[data-detail-pane]");
  const deckEditLink = deckLibrary.querySelector("[data-edit-deck]");
  const deckDeleteModeButton = deckLibrary.querySelector("[data-delete-mode]");
  const deckDeleteStrip = deckLibrary.querySelector("[data-delete-strip]");
  const deckSelectedCount = deckLibrary.querySelector("[data-delete-selected-count]");
  const deckConfirmDeleteButton = deckLibrary.querySelector("[data-confirm-delete]");
  const deckCancelDeleteButton = deckLibrary.querySelector("[data-cancel-delete]");
  const deckDeleteDialog = deckLibrary.querySelector("[data-delete-dialog]");
  const deckDeleteDialogCount = deckLibrary.querySelector("[data-delete-dialog-count]");
  const deckCancelConfirmDeleteButton = deckLibrary.querySelector("[data-cancel-confirm-delete]");
  const deckRunDeleteButton = deckLibrary.querySelector("[data-run-delete]");
  const exportDecksButton = deckLibrary.querySelector("[data-export-decks]");
  const importDecksButton = deckLibrary.querySelector("[data-import-decks]");
  const importDecksInput = deckLibrary.querySelector("[data-import-decks-file]");
  const deckTransferStatus = deckLibrary.querySelector("[data-transfer-status]");

  let allDecks = [];
  let allCards = [];
  let deckCurrentPage = 1;
  let selectedDeckId = "";
  let deckDeleteMode = false;
  let selectedDeckDeleteIds = new Set();

  function getDeckName(deck) {
    return String(deck.name || deck.deckName || "Unnamed Deck");
  }

  function getDeckCardIds(deck) {
    return Array.isArray(deck.cardIds) ? deck.cardIds : [];
  }

  function getDeckCreatedAt(deck) {
    const raw = deck.savedAt || deck.createdAt;
    const date = raw ? new Date(raw) : null;
    if (!date || isNaN(date)) return "Unknown";
    return date.toLocaleString([], {
      year: "numeric", month: "short", day: "numeric",
      hour: "numeric", minute: "2-digit"
    });
  }

  function getDeckCardCounts(deck) {
    const cardIds = getDeckCardIds(deck);
    let monster = 0;
    let spell = 0;
    let trap = 0;
    for (const id of cardIds) {
      const card = allCards.find((c) => c.id === id);
      const t = String(card?.cardType || "monster").toLowerCase();
      if (t === "spell") spell++;
      else if (t === "trap") trap++;
      else monster++;
    }
    return { total: cardIds.length, monster, spell, trap };
  }

  function getDeckCoverImage(deck) {
    if (deck.thumbnailImage) return deck.thumbnailImage;
    if (deck.coverCardId) {
      const cover = allCards.find((c) => c.id === deck.coverCardId);
      if (cover?.uploadedImage) return cover.uploadedImage;
    }
    const firstId = getDeckCardIds(deck)[0];
    if (firstId) {
      const first = allCards.find((c) => c.id === firstId);
      if (first?.uploadedImage) return first.uploadedImage;
    }
    return "";
  }

  function filteredDecks() {
    const query = String(deckSearchInput?.value || "").trim().toLowerCase();
    const sortBy = deckSortSelect?.value || "newest";
    const decks = allDecks.filter((deck) =>
      !query || getDeckName(deck).toLowerCase().includes(query)
    );
    decks.sort((a, b) => {
      if (sortBy === "oldest") return Date.parse(a.savedAt || a.createdAt || 0) - Date.parse(b.savedAt || b.createdAt || 0);
      if (sortBy === "name") return getDeckName(a).localeCompare(getDeckName(b));
      return Date.parse(b.savedAt || b.createdAt || 0) - Date.parse(a.savedAt || a.createdAt || 0);
    });
    return decks;
  }

  function createDeckMiniCard(deck) {
    const img = getDeckCoverImage(deck);
    const counts = getDeckCardCounts(deck);

    const article = document.createElement("article");
    article.className = "library-card-mini deck-mini";
    article.dataset.deckId = deck.id;
    article.classList.toggle("is-selected", deck.id === selectedDeckId);
    article.classList.toggle("is-delete-selected", selectedDeckDeleteIds.has(deck.id));

    const selector = document.createElement("label");
    selector.className = "card-select-bubble";
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.checked = selectedDeckDeleteIds.has(deck.id);
    checkbox.setAttribute("aria-label", `Select ${getDeckName(deck)} for deletion`);
    checkbox.addEventListener("change", () => {
      if (checkbox.checked) selectedDeckDeleteIds.add(deck.id);
      else selectedDeckDeleteIds.delete(deck.id);
      article.classList.toggle("is-delete-selected", selectedDeckDeleteIds.has(deck.id));
      updateDeckDeleteControls();
    });
    const selectorMark = document.createElement("span");
    selector.append(checkbox, selectorMark);

    const button = document.createElement("button");
    button.className = "library-card-button deck-mini-button";
    button.type = "button";
    button.addEventListener("click", () => {
      selectedDeckId = deck.id;
      renderDeckDetail();
      deckGrid?.querySelectorAll(".library-card-mini").forEach((el) => {
        el.classList.toggle("is-selected", el.dataset.deckId === selectedDeckId);
      });
    });

    const thumb = document.createElement("div");
    thumb.className = "deck-mini-thumb art-underworld";
    const thumbImg = document.createElement("img");
    thumbImg.className = "uploaded-art";
    thumbImg.alt = "";
    const thumbBeast = document.createElement("span");
    thumbBeast.className = "art-beast";
    thumbBeast.setAttribute("aria-hidden", "true");
    if (img) {
      thumbImg.src = img;
      thumb.classList.add("has-upload");
    }
    thumb.append(thumbImg, thumbBeast);

    const name = document.createElement("strong");
    name.className = "mini-card-title deck-mini-name";
    name.textContent = getDeckName(deck);

    const meta = document.createElement("div");
    meta.className = "deck-mini-meta";
    meta.textContent = `${counts.total} card${counts.total !== 1 ? "s" : ""}`;

    button.append(thumb, name, meta);
    article.append(selector, button);
    return article;
  }

  function renderDeckDetail() {
    if (!deckDetailPane) return;

    const selectedDeck = allDecks.find((d) => d.id === selectedDeckId);
    deckDetailPane.textContent = "";

    const heading = document.createElement("h2");
    heading.className = "deck-detail-section-heading";
    heading.textContent = "Deck Details";
    deckDetailPane.append(heading);

    if (!selectedDeck) {
      if (deckEditLink) deckEditLink.hidden = true;
      const empty = document.createElement("div");
      empty.className = "deck-detail-empty";
      const icon = document.createElement("span");
      icon.className = "deck-detail-icon";
      icon.setAttribute("aria-hidden", "true");
      const iconInner = document.createElement("span");
      icon.append(iconInner);
      const msg = document.createElement("p");
      msg.innerHTML = "Select a deck from the list<br>to view its details.";
      empty.append(icon, msg);
      deckDetailPane.append(empty);
      return;
    }

    if (deckEditLink) {
      deckEditLink.hidden = false;
      deckEditLink.href = `deck-creator.html?deck=${encodeURIComponent(selectedDeck.id)}`;
    }

    const counts = getDeckCardCounts(selectedDeck);
    const img = getDeckCoverImage(selectedDeck);

    const thumbWrap = document.createElement("div");
    thumbWrap.className = "deck-detail-thumb art-underworld";
    const thumbImg = document.createElement("img");
    thumbImg.className = "uploaded-art";
    thumbImg.alt = getDeckName(selectedDeck);
    const thumbBeast = document.createElement("span");
    thumbBeast.className = "art-beast";
    thumbBeast.setAttribute("aria-hidden", "true");
    if (img) {
      thumbImg.src = img;
      thumbWrap.classList.add("has-upload");
    }
    thumbWrap.append(thumbImg, thumbBeast);

    const facts = document.createElement("dl");
    facts.className = "library-card-facts";
    const rows = [
      ["Deck Name", getDeckName(selectedDeck)],
      ["Total Cards", String(counts.total)],
      ["Monster Cards", String(counts.monster)],
      ["Spell Cards", String(counts.spell)],
      ["Trap Cards", String(counts.trap)],
      ["Created On", getDeckCreatedAt(selectedDeck)]
    ];
    rows.forEach(([label, value]) => {
      const dt = document.createElement("dt");
      const dd = document.createElement("dd");
      dt.textContent = label;
      dd.textContent = value;
      facts.append(dt, dd);
    });

    deckDetailPane.append(thumbWrap, facts);
  }

  function updateDeckDeleteControls() {
    deckLibrary.classList.toggle("is-delete-mode", deckDeleteMode);
    if (deckDeleteModeButton) deckDeleteModeButton.classList.toggle("is-active", deckDeleteMode);
    if (deckDeleteStrip) deckDeleteStrip.hidden = !deckDeleteMode;
    if (deckSelectedCount) deckSelectedCount.textContent = `${selectedDeckDeleteIds.size} selected`;
    if (deckConfirmDeleteButton) deckConfirmDeleteButton.disabled = selectedDeckDeleteIds.size === 0;
  }

  function renderDeckPagination(total) {
    if (!deckPagination) return;
    deckPagination.textContent = "";
    const pageCount = Math.max(1, Math.ceil(total / DECK_PAGE_SIZE));
    deckCurrentPage = Math.min(Math.max(deckCurrentPage, 1), pageCount);

    function addPageBtn(label, page, isCurrent = false, disabled = false) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.textContent = label;
      btn.disabled = disabled;
      btn.classList.toggle("is-current", isCurrent);
      btn.addEventListener("click", () => {
        deckCurrentPage = page;
        renderDecks();
      });
      deckPagination.append(btn);
    }

    addPageBtn("<<", Math.max(deckCurrentPage - 1, 1), false, deckCurrentPage === 1);
    const start = Math.max(1, deckCurrentPage - 2);
    const end = Math.min(pageCount, deckCurrentPage + 2);
    if (start > 1) {
      addPageBtn("1", 1, deckCurrentPage === 1);
      if (start > 2) {
        const dots = document.createElement("span");
        dots.textContent = "...";
        deckPagination.append(dots);
      }
    }
    for (let page = start; page <= end; page++) {
      addPageBtn(String(page), page, page === deckCurrentPage);
    }
    if (end < pageCount) {
      if (end < pageCount - 1) {
        const dots = document.createElement("span");
        dots.textContent = "...";
        deckPagination.append(dots);
      }
      addPageBtn(String(pageCount), pageCount, deckCurrentPage === pageCount);
    }
    addPageBtn(">>", Math.min(deckCurrentPage + 1, pageCount), false, deckCurrentPage === pageCount);
  }

  function renderDecks() {
    if (!deckGrid) return;
    const decks = filteredDecks();
    const pageCount = Math.max(1, Math.ceil(decks.length / DECK_PAGE_SIZE));
    deckCurrentPage = Math.min(Math.max(deckCurrentPage, 1), pageCount);
    const startIndex = (deckCurrentPage - 1) * DECK_PAGE_SIZE;
    const pageDecks = decks.slice(startIndex, startIndex + DECK_PAGE_SIZE);

    deckGrid.textContent = "";
    pageDecks.forEach((deck) => deckGrid.append(createDeckMiniCard(deck)));

    if (pageDecks.length === 0) {
      const empty = document.createElement("div");
      empty.className = "library-empty-state";
      empty.textContent = allDecks.length === 0 ? "No decks created yet." : "No decks match the current search.";
      deckGrid.append(empty);
    }

    if (deckCountLabel) {
      if (decks.length === 0) {
        deckCountLabel.textContent = "No decks found";
      } else {
        deckCountLabel.textContent = `${decks.length} deck${decks.length !== 1 ? "s" : ""}`;
      }
    }

    renderDeckPagination(decks.length);
    updateDeckDeleteControls();
  }

  function setDeckDeleteMode(enabled) {
    deckDeleteMode = enabled;
    if (!deckDeleteMode) selectedDeckDeleteIds = new Set();
    renderDecks();
  }

  function openDeckDeleteDialog() {
    if (!deckDeleteDialog || selectedDeckDeleteIds.size === 0) return;
    if (deckDeleteDialogCount) {
      deckDeleteDialogCount.textContent = `${selectedDeckDeleteIds.size} deck${selectedDeckDeleteIds.size === 1 ? "" : "s"} will be permanently deleted.`;
    }
    deckDeleteDialog.hidden = false;
    deckRunDeleteButton?.focus();
  }

  function closeDeckDeleteDialog() {
    if (deckDeleteDialog) deckDeleteDialog.hidden = true;
  }

  async function runBulkDeckDelete() {
    if (selectedDeckDeleteIds.size === 0) { closeDeckDeleteDialog(); return; }
    const ids = [...selectedDeckDeleteIds];
    deckRunDeleteButton?.setAttribute("disabled", "");
    try {
      const result = await window.BattleOfCreationsStore.deleteDecks(ids);
      const deletedIds = new Set(result.deletedIds || ids);
      allDecks = allDecks.filter((deck) => !deletedIds.has(deck.id));
      if (deletedIds.has(selectedDeckId)) selectedDeckId = "";
      selectedDeckDeleteIds = new Set();
      deckDeleteMode = false;
      closeDeckDeleteDialog();
      renderDeckDetail();
      renderDecks();
    } finally {
      deckRunDeleteButton?.removeAttribute("disabled");
    }
  }

  async function loadDeckLibrary() {
    const user = await sessionReady;
    if (!user) return;
    try {
      const library = await window.BattleOfCreationsStore.getLibrary();
      allDecks = library.decks;
      allCards = library.cards;
      renderDeckDetail();
      renderDecks();
    } catch (error) {
      if (deckCountLabel) deckCountLabel.textContent = error.message || "Decks could not be loaded.";
    }
  }

  async function exportDecks() {
    if (allDecks.length === 0) {
      updateTransferStatus(deckTransferStatus, "There are no decks to export.", true);
      return;
    }

    try {
      updateTransferStatus(
        deckTransferStatus,
        `Export started for ${allDecks.length} deck${allDecks.length === 1 ? "" : "s"}. Referenced cards are included and the download can continue while you use another page.`
      );
      startServerDownload("/api/export/decks");
    } catch (error) {
      updateTransferStatus(deckTransferStatus, error.message || "Decks could not be exported.", true);
    }
  }

  async function importDecks(event) {
    const file = event.target.files?.[0];
    if (!file) return;

    exportDecksButton?.setAttribute("disabled", "");
    importDecksButton?.setAttribute("disabled", "");
    updateTransferStatus(deckTransferStatus, `Importing ${file.name}...`);
    await yieldToBrowser();

    try {
      const response = await window.BattleOfCreationsStore.importDecksPackage(file);
      const completedTask = await waitForBackgroundTask(response.task, (task) => {
        updateTransferStatus(deckTransferStatus, backgroundTaskMessage(task));
      }, false);
      const result = completedTask.result || {};
      await loadDeckLibrary();
      const skipped = Number(result.skippedCardReferences || 0);
      const skippedText = skipped > 0
        ? ` ${skipped} missing card reference${skipped === 1 ? " was" : "s were"} skipped.`
        : "";
      updateTransferStatus(
        deckTransferStatus,
        `${result.importedDeckCount || 0} deck${result.importedDeckCount === 1 ? "" : "s"} and ${result.importedCardCount || 0} card${result.importedCardCount === 1 ? "" : "s"} imported.${skippedText}`
      );
    } catch (error) {
      updateTransferStatus(deckTransferStatus, error.message || "Decks could not be imported.", true);
    } finally {
      event.target.value = "";
      exportDecksButton?.removeAttribute("disabled");
      importDecksButton?.removeAttribute("disabled");
    }
  }

  deckSearchInput?.addEventListener("input", () => { deckCurrentPage = 1; renderDecks(); });
  deckSortSelect?.addEventListener("change", () => { deckCurrentPage = 1; renderDecks(); });
  deckDeleteModeButton?.addEventListener("click", () => setDeckDeleteMode(!deckDeleteMode));
  deckCancelDeleteButton?.addEventListener("click", () => setDeckDeleteMode(false));
  deckConfirmDeleteButton?.addEventListener("click", openDeckDeleteDialog);
  deckCancelConfirmDeleteButton?.addEventListener("click", closeDeckDeleteDialog);
  deckRunDeleteButton?.addEventListener("click", runBulkDeckDelete);
  exportDecksButton?.addEventListener("click", exportDecks);
  importDecksButton?.addEventListener("click", () => importDecksInput?.click());
  importDecksInput?.addEventListener("change", importDecks);
  document.addEventListener("boc:background-task-complete", (event) => {
    if (event.detail?.kind === "decks-import") {
      loadDeckLibrary();
    }
  });
  deckDeleteDialog?.addEventListener("click", (event) => {
    if (event.target === deckDeleteDialog) closeDeckDeleteDialog();
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") closeDeckDeleteDialog();
  });

  renderDeckDetail();
  loadDeckLibrary();
}

// ===== Deck Creator =====
const deckCreatorEl = document.querySelector("[data-deck-creator]");

if (deckCreatorEl) {
  const DC_ROWS = 10;
  const DC_COLS = 5;
  const DC_MAX = DC_ROWS * DC_COLS;
  const DC_COLLECTION_PAGE_SIZE = 25;

  // Element refs — new HTML structure
  const dcSlotsContainer = deckCreatorEl.querySelector("[data-dc-slots]");
  const dcSlotCount = deckCreatorEl.querySelector("[data-dc-slot-count]");
  const dcNameInput = deckCreatorEl.querySelector("[data-dc-name]");
  const dcNameCount = deckCreatorEl.querySelector("[data-dc-name-count]");
  const dcThumbInput = deckCreatorEl.querySelector("[data-dc-thumb-input]");
  const dcThumbLabel = deckCreatorEl.querySelector("[data-dc-thumb-label]");
  const dcThumbPreview = deckCreatorEl.querySelector("[data-dc-thumb-preview]");
  const dcTypeFilter = deckCreatorEl.querySelector("[data-dc-type-filter]");
  const dcRarityFilter = deckCreatorEl.querySelector("[data-dc-rarity-filter]");
  const dcSortFilter = deckCreatorEl.querySelector("[data-dc-sort-filter]");
  const dcSearch = deckCreatorEl.querySelector("[data-dc-search]");
  const dcFilterReset = deckCreatorEl.querySelector("[data-dc-filter-reset]");
  const dcCollection = deckCreatorEl.querySelector("[data-dc-collection]");
  const dcPagination = deckCreatorEl.querySelector("[data-dc-pagination]");
  const dcCardsShowing = deckCreatorEl.querySelector("[data-dc-cards-showing]");
  const dcSaveBtn = deckCreatorEl.querySelector("[data-dc-save]");
  const dcClearBtn = deckCreatorEl.querySelector("[data-dc-clear]");
  const dcMessage = deckCreatorEl.querySelector("[data-dc-message]");
  const dcTitleEl = deckCreatorEl.querySelector("[data-deck-creator-title]");
  const dcSelectedPanel = deckCreatorEl.querySelector("[data-dc-selected]");

  const editDeckId = new URLSearchParams(window.location.search).get("deck");
  let dcActiveDeckId = editDeckId || createId("deck");
  let dcAllCards = [];
  let dcSlots = new Array(DC_MAX).fill(null);
  let dcCollectionPage = 1;
  let dcThumbnailDataUrl = "";
  let dcSelectedCard = null;

  // ---- Helpers ----
  function dcCardType(card) {
    return ["monster", "spell", "trap"].includes(card.cardType) ? card.cardType : "monster";
  }
  function dcCardName(card) { return String(card.cardName || "Unnamed Creation"); }
  function dcCapitalizeFirstLetter(value) {
    const text = String(value || "").trim();
    if (!text) return "";
    return `${text.charAt(0).toUpperCase()}${text.slice(1)}`;
  }
  function dcCardDescription(card) {
    let description = "";
    if (dcCardType(card) === "monster") description = cardEffectDescription(card);
    else if (dcCardType(card) === "spell") description = card.spellEffectDescription || "No effect selected.";
    else description = card.trapEffectDescription || "No effect selected.";
    return dcCapitalizeFirstLetter(description);
  }
  function dcCardPosition(card) {
    return { x: Number(card.imagePosition?.x) || 50, y: Number(card.imagePosition?.y) || 50 };
  }
  function dcFilledSlots() { return dcSlots.filter(Boolean).length; }

  // ---- Selected Card Panel ----
  function dcShowSelectedCard(card) {
    dcSelectedCard = card;
    if (!dcSelectedPanel) return;
    const type = dcCardType(card);
    const pos = dcCardPosition(card);

    // Mark the active card in collection
    dcCollection?.querySelectorAll(".dc-card-item").forEach((el) => {
      el.classList.toggle("is-selected", el.dataset.cardId === card.id);
    });

    dcSelectedPanel.textContent = "";

    // Mini art preview
    const artWrap = document.createElement("div");
    artWrap.className = `dc-sel-art art-underworld card-kind-${type}`;
    artWrap.style.setProperty("--art-x", `${pos.x}%`);
    artWrap.style.setProperty("--art-y", `${pos.y}%`);
    const artImg = document.createElement("img");
    artImg.className = "uploaded-art";
    artImg.alt = "";
    const artBeast = document.createElement("span");
    artBeast.className = "art-beast";
    artBeast.setAttribute("aria-hidden", "true");
    if (card.uploadedImage) { artWrap.classList.add("has-upload"); artImg.src = card.uploadedImage; }

    // Deck stepper: - [count] + overlaid on art (top-right)
    const stepperWrap = document.createElement("div");
    stepperWrap.className = "dc-sel-stepper";

    const btnMinus = document.createElement("button");
    btnMinus.type = "button";
    btnMinus.className = "dc-stepper-btn dc-stepper-minus";
    btnMinus.textContent = "−";
    btnMinus.setAttribute("aria-label", "Remove from deck");

    const countDisplay = document.createElement("span");
    countDisplay.className = "dc-stepper-count";

    const btnPlus = document.createElement("button");
    btnPlus.type = "button";
    btnPlus.className = "dc-stepper-btn dc-stepper-plus";
    btnPlus.textContent = "+";
    btnPlus.setAttribute("aria-label", "Add to deck");

    function dcUpdateStepper() {
      const count = dcSlots.filter(s => s && s.id === card.id).length;
      const isFull = dcFilledSlots() >= DC_MAX;
      countDisplay.textContent = String(count);
      btnMinus.disabled = count === 0;
      btnPlus.disabled = count >= 3 || (isFull && count === 0);
    }
    dcUpdateStepper();

    btnMinus.addEventListener("click", (e) => {
      e.stopPropagation();
      const idx = [...dcSlots.keys()].filter(i => dcSlots[i] && dcSlots[i].id === card.id).pop();
      if (idx !== undefined) dcSlots[idx] = null;
      dcRenderSlots();
      dcUpdateSlotCount();
      dcUpdateStepper();
      dcRenderCollection();
    });

    btnPlus.addEventListener("click", (e) => {
      e.stopPropagation();
      const count = dcSlots.filter(s => s && s.id === card.id).length;
      if (count >= 3 || dcFilledSlots() >= DC_MAX) return;
      const emptyIdx = dcSlots.findIndex(s => s === null);
      if (emptyIdx === -1) return;
      dcSlots[emptyIdx] = card;
      dcRenderSlots();
      dcUpdateSlotCount();
      dcUpdateStepper();
      dcRenderCollection();
    });

    stepperWrap.append(btnMinus, countDisplay, btnPlus);
    artWrap.append(artImg, artBeast, stepperWrap);
    dcSelectedPanel.append(artWrap);

    // Details table
    const rows = [
      ["Card Type", CARD_TYPE_LABELS[type] || type],
      ["Card Name", dcCardName(card)],
    ];
    if (type === "monster") {
      rows.push(["Level", String(card.level || 1)]);
      rows.push(["Monster Type", String(card.monsterType || "Effect")]);
      rows.push(["Attack Points", String(card.attack ?? 0)]);
      rows.push(["Defense Points", String(card.defense ?? 0)]);
    }
    rows.push(["Effect Description", dcCardDescription(card)]);

    const dl = document.createElement("dl");
    dl.className = "dc-sel-dl";
    rows.forEach(([label, value]) => {
      const dt = document.createElement("dt");
      dt.textContent = label;
      const dd = document.createElement("dd");
      dd.textContent = value;
      dl.append(dt, dd);
    });
    dcSelectedPanel.append(dl);

  }

  function dcClearSelectedCard() {
    dcSelectedCard = null;
    if (!dcSelectedPanel) return;
    dcCollection?.querySelectorAll(".dc-card-item").forEach((el) => el.classList.remove("is-selected"));
    dcSelectedPanel.textContent = "";
    const hint = document.createElement("p");
    hint.className = "dc-selected-empty";
    hint.textContent = "Select a card from your collection to view its details.";
    dcSelectedPanel.append(hint);
    const dl = document.createElement("dl");
    dl.className = "dc-sel-dl dc-sel-dl-empty";
    [["Card Type","—"],["Card Name","—"],["Level","—"],["Monster Type","—"],["Attack Points","—"],["Defense Points","—"],["Effect Description","—"]].forEach(([label, val]) => {
      const dt = document.createElement("dt"); dt.textContent = label;
      const dd = document.createElement("dd"); dd.textContent = val;
      dl.append(dt, dd);
    });
    dcSelectedPanel.append(dl);
  }

  // ---- Slot rendering ----
  function dcUpdateSlotCount() {
    if (dcSlotCount) dcSlotCount.textContent = `${dcFilledSlots()}/50`;
  }

  function dcRenderSlots() {
    if (!dcSlotsContainer) return;
    dcSlotsContainer.textContent = "";
    for (let row = 0; row < DC_ROWS; row++) {
      const rowEl = document.createElement("div");
      rowEl.className = "dc-slot-row";
      const rowLabel = document.createElement("span");
      rowLabel.className = "dc-row-label";
      rowLabel.setAttribute("aria-hidden", "true");
      rowLabel.textContent = String(row + 1);
      rowEl.append(rowLabel);
      for (let col = 0; col < DC_COLS; col++) {
        const idx = row * DC_COLS + col;
        const cell = document.createElement("div");
        cell.className = "dc-slot-cell";
        cell.dataset.slotIndex = String(idx);
        cell.setAttribute("aria-label", `Slot ${row + 1}-${col + 1}`);
        cell.setAttribute("role", "button");
        cell.setAttribute("tabindex", "0");

        const card = dcSlots[idx];
        if (card) {
          const type = dcCardType(card);
          cell.classList.add("is-filled", `slot-kind-${type}`);
          const pos = dcCardPosition(card);
          const cellArt = document.createElement("div");
          cellArt.className = "dc-slot-art art-underworld";
          cellArt.style.setProperty("--art-x", `${pos.x}%`);
          cellArt.style.setProperty("--art-y", `${pos.y}%`);
          const cellImg = document.createElement("img");
          cellImg.className = "uploaded-art";
          cellImg.alt = dcCardName(card);
          if (card.uploadedImage) { cellArt.classList.add("has-upload"); cellImg.src = card.uploadedImage; }
          const cellBeast = document.createElement("span");
          cellBeast.className = "art-beast";
          cellBeast.setAttribute("aria-hidden", "true");
          cellArt.append(cellImg, cellBeast);

          // Remove "×" overlay
          const removeX = document.createElement("span");
          removeX.className = "dc-slot-remove";
          removeX.setAttribute("aria-hidden", "true");
          removeX.textContent = "×";

          cell.append(cellArt, removeX);

          cell.addEventListener("click", () => {
            dcSlots[idx] = null;
            dcRenderSlots();
            dcUpdateSlotCount();
            dcRenderCollection();
            if (dcSelectedCard) dcShowSelectedCard(dcSelectedCard);
          });
          cell.addEventListener("keydown", (e) => {
            if (e.key === "Enter" || e.key === " ") {
              dcSlots[idx] = null; dcRenderSlots(); dcUpdateSlotCount(); dcRenderCollection();
              if (dcSelectedCard) dcShowSelectedCard(dcSelectedCard);
            }
          });
        }

        // Drag-and-drop target
        cell.addEventListener("dragover", (e) => { e.preventDefault(); cell.classList.add("dc-slot-drag-over"); });
        cell.addEventListener("dragleave", () => cell.classList.remove("dc-slot-drag-over"));
        cell.addEventListener("drop", (e) => {
          e.preventDefault();
          cell.classList.remove("dc-slot-drag-over");
          const cardId = e.dataTransfer?.getData("text/plain");
          if (!cardId) return;
          const droppedCard = dcAllCards.find((c) => c.id === cardId);
          if (!droppedCard) return;
          if (dcFilledSlots() >= DC_MAX && !dcSlots[idx]) return;
          dcSlots[idx] = droppedCard;
          dcRenderSlots();
          dcUpdateSlotCount();
          dcRenderCollection();
          if (dcSelectedCard) dcShowSelectedCard(dcSelectedCard);
        });

        rowEl.append(cell);
      }
      dcSlotsContainer.append(rowEl);
    }
    dcUpdateSlotCount();
  }

  // ---- Collection rendering ----
  function dcFilteredCards() {
    const query = String(dcSearch?.value || "").trim().toLowerCase();
    const type = dcTypeFilter?.value || "all";
    const sort = dcSortFilter?.value || "newest";
    let cards = dcAllCards.filter((card) => {
      if (type !== "all" && dcCardType(card) !== type) return false;
      if (query && !dcCardName(card).toLowerCase().includes(query)) return false;
      return true;
    });
    cards = [...cards].sort((a, b) => {
      if (sort === "newest") return (new Date(b.savedAt || 0)) - (new Date(a.savedAt || 0));
      if (sort === "oldest") return (new Date(a.savedAt || 0)) - (new Date(b.savedAt || 0));
      if (sort === "name-asc") return dcCardName(a).localeCompare(dcCardName(b));
      if (sort === "name-desc") return dcCardName(b).localeCompare(dcCardName(a));
      if (sort === "atk-desc") return (Number(b.attack) || 0) - (Number(a.attack) || 0);
      if (sort === "atk-asc") return (Number(a.attack) || 0) - (Number(b.attack) || 0);
      return 0;
    });
    return cards;
  }

  function dcRenderCollection() {
    if (!dcCollection) return;
    const cards = dcFilteredCards();
    const total = cards.length;
    const pageCount = Math.max(1, Math.ceil(total / DC_COLLECTION_PAGE_SIZE));
    dcCollectionPage = Math.min(Math.max(dcCollectionPage, 1), pageCount);
    const start = (dcCollectionPage - 1) * DC_COLLECTION_PAGE_SIZE;
    const end = Math.min(start + DC_COLLECTION_PAGE_SIZE, total);
    const pageCards = cards.slice(start, end);

    dcCollection.textContent = "";

    if (dcCardsShowing) {
      dcCardsShowing.textContent = total > 0 ? `Showing ${start + 1}–${end} of ${total}` : "";
    }

    // Sync type quick-buttons active state
    deckCreatorEl.querySelectorAll("[data-dc-type-quick]").forEach((btn) => {
      btn.classList.toggle("is-active", btn.dataset.dcTypeQuick === (dcTypeFilter?.value || "all"));
    });

    if (pageCards.length === 0) {
      const empty = document.createElement("div");
      empty.className = "dc-collection-empty";
      empty.textContent = dcAllCards.length === 0 ? "No cards created yet." : "No cards match the filters.";
      dcCollection.append(empty);
      dcRenderPagination(total);
      return;
    }

    pageCards.forEach((card) => {
      const type = dcCardType(card);
      const pos = dcCardPosition(card);
      const article = document.createElement("article");
      article.className = `dc-card-item card-kind-${type}`;
      article.setAttribute("draggable", "true");
      article.setAttribute("title", dcCardName(card));
      article.dataset.cardId = card.id;
      if (dcSelectedCard && dcSelectedCard.id === card.id) article.classList.add("is-selected");

      const inDeckCount = dcSlots.filter((s) => s && s.id === card.id).length;
      if (inDeckCount > 0) article.classList.add("is-in-deck");

      // Drag to add to slot
      article.addEventListener("dragstart", (e) => {
        e.dataTransfer.setData("text/plain", card.id);
        article.classList.add("is-dragging");
      });
      article.addEventListener("dragend", () => article.classList.remove("is-dragging"));

      // Click → show in Selected Card panel
      article.addEventListener("click", () => dcShowSelectedCard(card));

      const artDiv = document.createElement("div");
      artDiv.className = "dc-card-art art-underworld";
      artDiv.style.setProperty("--art-x", `${pos.x}%`);
      artDiv.style.setProperty("--art-y", `${pos.y}%`);
      const artImg = document.createElement("img");
      artImg.className = "uploaded-art";
      artImg.alt = "";
      const artBeast = document.createElement("span");
      artBeast.className = "art-beast";
      artBeast.setAttribute("aria-hidden", "true");
      if (card.uploadedImage) { artDiv.classList.add("has-upload"); artImg.src = card.uploadedImage; }
      artDiv.append(artImg, artBeast);

      if (inDeckCount > 0) {
        const badge = document.createElement("span");
        badge.className = "dc-in-deck-badge";
        badge.textContent = String(inDeckCount);
        artDiv.append(badge);
      }

      const nameEl = document.createElement("strong");
      nameEl.className = "dc-card-name";
      nameEl.textContent = dcCardName(card);

      const footerEl = document.createElement("div");
      footerEl.className = "dc-card-footer";
      if (type === "monster") {
        const atkIcon = document.createElement("img");
        atkIcon.src = "assets/icons/atk_points_icon.png"; atkIcon.alt = "ATK";
        const defIcon = document.createElement("img");
        defIcon.src = "assets/icons/def_points_icon.png"; defIcon.alt = "DEF";
        const atkSpan = document.createElement("span");
        atkSpan.className = "dc-card-stat";
        atkSpan.append(atkIcon, document.createTextNode(String(card.attack ?? 0)));
        const defSpan = document.createElement("span");
        defSpan.className = "dc-card-stat";
        defSpan.append(defIcon, document.createTextNode(String(card.defense ?? 0)));
        footerEl.append(atkSpan, defSpan);
      } else {
        const typeTag = document.createElement("span");
        typeTag.className = "dc-card-tag";
        typeTag.textContent = type === "spell" ? "Spell" : "Trap";
        footerEl.append(typeTag);
      }

      article.append(artDiv, nameEl, footerEl);
      dcCollection.append(article);
    });

    dcRenderPagination(total);
  }

  function dcRenderPagination(total) {
    if (!dcPagination) return;
    dcPagination.textContent = "";
    const pageCount = Math.max(1, Math.ceil(total / DC_COLLECTION_PAGE_SIZE));
    dcCollectionPage = Math.min(Math.max(dcCollectionPage, 1), pageCount);
    if (pageCount <= 1) return;

    function addBtn(label, page, isCurrent = false, disabled = false) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.textContent = label;
      btn.disabled = disabled;
      btn.classList.toggle("is-current", isCurrent);
      btn.addEventListener("click", () => { dcCollectionPage = page; dcRenderCollection(); });
      dcPagination.append(btn);
    }

    addBtn("«", 1, false, dcCollectionPage === 1);
    addBtn("‹", Math.max(dcCollectionPage - 1, 1), false, dcCollectionPage === 1);

    const WINDOW = 2;
    const startP = Math.max(1, dcCollectionPage - WINDOW);
    const endP = Math.min(pageCount, dcCollectionPage + WINDOW);

    if (startP > 1) {
      addBtn("1", 1, false);
      if (startP > 2) { const s = document.createElement("span"); s.className = "dc-pag-ellipsis"; s.textContent = "..."; dcPagination.append(s); }
    }
    for (let p = startP; p <= endP; p++) addBtn(String(p), p, p === dcCollectionPage);
    if (endP < pageCount) {
      if (endP < pageCount - 1) { const s = document.createElement("span"); s.className = "dc-pag-ellipsis"; s.textContent = "..."; dcPagination.append(s); }
      addBtn(String(pageCount), pageCount, false);
    }

    addBtn("›", Math.min(dcCollectionPage + 1, pageCount), false, dcCollectionPage === pageCount);
    addBtn("»", pageCount, false, dcCollectionPage === pageCount);
  }

  // ---- Name counter ----
  dcNameInput?.addEventListener("input", () => {
    const len = dcNameInput.value.length;
    if (dcNameCount) dcNameCount.textContent = `${len}/50`;
  });

  // ---- Thumbnail upload ----
  function dcApplyThumb(file) {
    if (!file || !file.type.startsWith("image/")) return;
    const reader = new FileReader();
    reader.addEventListener("load", () => {
      dcThumbnailDataUrl = String(reader.result);
      if (dcThumbPreview) { dcThumbPreview.src = dcThumbnailDataUrl; dcThumbPreview.hidden = false; }
      const hint = dcThumbLabel?.querySelector(".dc-thumb-label-text");
      if (hint) hint.hidden = true;
      const icon = dcThumbLabel?.querySelector(".dc-thumb-icon");
      if (icon) icon.hidden = true;
    });
    reader.readAsDataURL(file);
  }
  dcThumbInput?.addEventListener("change", () => dcApplyThumb(dcThumbInput.files?.[0]));
  dcThumbLabel?.addEventListener("dragover", (e) => { e.preventDefault(); dcThumbLabel.classList.add("is-drag-over"); });
  dcThumbLabel?.addEventListener("dragleave", () => dcThumbLabel.classList.remove("is-drag-over"));
  dcThumbLabel?.addEventListener("drop", (e) => { e.preventDefault(); dcThumbLabel.classList.remove("is-drag-over"); dcApplyThumb(e.dataTransfer?.files?.[0]); });

  // ---- Type filter + quick buttons ----
  dcTypeFilter?.addEventListener("change", () => { dcCollectionPage = 1; dcRenderCollection(); });
  deckCreatorEl.querySelectorAll("[data-dc-type-quick]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const val = btn.dataset.dcTypeQuick;
      if (dcTypeFilter) {
        dcTypeFilter.value = dcTypeFilter.value === val ? "all" : val;
      }
      dcCollectionPage = 1;
      dcRenderCollection();
    });
  });

  // ---- Other filters ----
  dcSearch?.addEventListener("input", () => { dcCollectionPage = 1; dcRenderCollection(); });
  dcSortFilter?.addEventListener("change", () => { dcCollectionPage = 1; dcRenderCollection(); });
  dcRarityFilter?.addEventListener("change", () => { dcCollectionPage = 1; dcRenderCollection(); });

  dcFilterReset?.addEventListener("click", () => {
    if (dcTypeFilter) dcTypeFilter.value = "all";
    if (dcSearch) dcSearch.value = "";
    if (dcSortFilter) dcSortFilter.value = "newest";
    if (dcRarityFilter) dcRarityFilter.value = "all";
    dcCollectionPage = 1;
    dcRenderCollection();
  });

  // ---- Clear ----
  dcClearBtn?.addEventListener("click", () => {
    dcSlots = new Array(DC_MAX).fill(null);
    dcRenderSlots();
    dcUpdateSlotCount();
  });

  // ---- Save ----
  dcSaveBtn?.addEventListener("click", async () => {
    const name = dcNameInput?.value.trim() || "";
    if (!name) {
      showDcMessage("Please enter a deck name.", true);
      dcNameInput?.focus();
      return;
    }
    const cardIds = dcSlots.filter(Boolean).map((c) => c.id);
    const deck = {
      id: dcActiveDeckId,
      name,
      deckName: name,
      cardIds,
      thumbnailImage: dcThumbnailDataUrl,
      savedAt: new Date().toISOString()
    };
    dcSaveBtn.disabled = true;
    try {
      await window.BattleOfCreationsStore.saveDeck(deck);
      window.location.href = "decks.html";
    } catch (error) {
      showDcMessage(error.message || "Could not save deck.", true);
    } finally {
      dcSaveBtn.disabled = false;
    }
  });

  function showDcMessage(text, isError = false) {
    if (!dcMessage) return;
    dcMessage.textContent = text;
    dcMessage.hidden = false;
    dcMessage.classList.toggle("is-error", isError);
    setTimeout(() => { dcMessage.hidden = true; }, 3500);
  }

  // ---- Load deck (edit mode) ----
  async function loadDeckCreator() {
    const user = await sessionReady;
    if (!user) return;
    try {
      const library = await window.BattleOfCreationsStore.getLibrary();
      dcAllCards = library.cards;
      if (editDeckId) {
        if (dcTitleEl) dcTitleEl.textContent = "Edit Deck";
        const existing = library.decks.find((d) => d.id === editDeckId);
        if (existing) {
          if (dcNameInput) {
            dcNameInput.value = existing.name || existing.deckName || "";
            if (dcNameCount) dcNameCount.textContent = `${dcNameInput.value.length}/50`;
          }
          if (existing.thumbnailImage) {
            dcThumbnailDataUrl = existing.thumbnailImage;
            if (dcThumbPreview) { dcThumbPreview.src = dcThumbnailDataUrl; dcThumbPreview.hidden = false; }
            const hint = dcThumbLabel?.querySelector(".dc-thumb-label-text");
            if (hint) hint.hidden = true;
            const icon = dcThumbLabel?.querySelector(".dc-thumb-icon");
            if (icon) icon.hidden = true;
          }
          const ids = Array.isArray(existing.cardIds) ? existing.cardIds : [];
          ids.forEach((id, idx) => {
            if (idx >= DC_MAX) return;
            const card = dcAllCards.find((c) => c.id === id);
            if (card) dcSlots[idx] = card;
          });
        }
      }
    } catch (_) { /* ignore */ }
    dcRenderSlots();
    dcRenderCollection();
    dcClearSelectedCard();
  }

  loadDeckCreator();
}

const cardCreator = document.querySelector("[data-card-creator]");

if (cardCreator) {
  const form = cardCreator.querySelector("[data-card-form]");
  const previewCard = cardCreator.querySelector("[data-preview-card]");
  const previewName = cardCreator.querySelector("[data-preview-name]");
  const previewAttribute = cardCreator.querySelector("[data-preview-attribute]");
  const previewArt = cardCreator.querySelector("[data-preview-art]");
  const uploadedArtPreview = cardCreator.querySelector("[data-uploaded-art-preview]");
  const previewStars = cardCreator.querySelector("[data-preview-stars]");
  const previewType = cardCreator.querySelector("[data-preview-type]");
  const previewTypeLine = cardCreator.querySelector("[data-preview-type-line]");
  const previewDescription = cardCreator.querySelector("[data-preview-description]");
  const previewAttack = cardCreator.querySelector("[data-preview-attack]");
  const previewDefense = cardCreator.querySelector("[data-preview-defense]");
  const imageThumb = cardCreator.querySelector("[data-image-thumb]");
  const uploadedArtThumb = cardCreator.querySelector("[data-uploaded-art-thumb]");
  const imageUpload = cardCreator.querySelector("[data-card-image]");
  const uploadLabel = cardCreator.querySelector("[data-upload-label]");
  const removeImageButton = cardCreator.querySelector("[data-remove-image]");
  const imagePositionX = cardCreator.querySelector('[data-image-position="x"]');
  const imagePositionY = cardCreator.querySelector('[data-image-position="y"]');
  const centerImageButton = cardCreator.querySelector("[data-center-image]");
  const levelButtons = cardCreator.querySelector("[data-level-buttons]");
  const nameCount = cardCreator.querySelector("[data-name-count]");
  const effectCount = cardCreator.querySelector("[data-effect-count]");
  const descriptionCount = cardCreator.querySelector("[data-description-count]");
  const cardOptionsLegend = cardCreator.querySelector("[data-card-options-legend]");
  const cardOptionsFieldset = cardCreator.querySelector("[data-card-options-fieldset]");
  const combatStatsFieldset = cardCreator.querySelector("[data-combat-stats-fieldset]");
  const effectDescriptionFieldset = cardCreator.querySelector("[data-effect-description-fieldset]");
  const previewMetaEl = cardCreator.querySelector("[data-preview-meta]");
  const previewStatsEl = cardCreator.querySelector("[data-preview-stats]");
  const monsterTypeField = cardCreator.querySelector("[data-monster-type-field]");
  const descriptionLegend = cardCreator.querySelector("[data-description-legend]");
  const effectTypeField = cardCreator.querySelector("[data-effect-type-field]");
  const effectBuilderFields = cardCreator.querySelector("[data-effect-builder-fields]");
  const effectParamPanel = cardCreator.querySelector("[data-effect-param-panel]");
  const effectParamFields = Array.from(cardCreator.querySelectorAll("[data-effect-param-field]"));
  const effectUsageField = cardCreator.querySelector("[data-effect-usage-field]");
  const effectDescriptionField = cardCreator.querySelector("[data-effect-description-field]");
  const shortDescriptionField = cardCreator.querySelector("[data-short-description-field]");
  const spellEffectFieldset = cardCreator.querySelector("[data-spell-effect-fieldset]");
  const spellEffectSelect = cardCreator.querySelector("[data-spell-effect-select]");
  const spellStatTypeSelect = cardCreator.querySelector("[data-spell-stat-type]");
  const spellParamPanel = cardCreator.querySelector("[data-spell-param-panel]");
  const spellParamFields = Array.from(cardCreator.querySelectorAll("[data-spell-param-field]"));
  const spellDescriptionField = cardCreator.querySelector("[data-spell-description-field]");
  const spellEffectCount = cardCreator.querySelector("[data-spell-effect-count]");
  const trapEffectFieldset = cardCreator.querySelector("[data-trap-effect-fieldset]");
  const trapEffectSelect = cardCreator.querySelector("[data-trap-effect-select]");
  const trapStatTypeSelect = cardCreator.querySelector("[data-trap-stat-type]");
  const trapParamPanel = cardCreator.querySelector("[data-trap-param-panel]");
  const trapParamFields = Array.from(cardCreator.querySelectorAll("[data-trap-param-field]"));
  const trapDescriptionField = cardCreator.querySelector("[data-trap-description-field]");
  const trapEffectCount = cardCreator.querySelector("[data-trap-effect-count]");
  const creatorMessage = cardCreator.querySelector("[data-creator-message]");
  const saveButton = cardCreator.querySelector(".creator-save");
  const creatorTitle = cardCreator.querySelector(".creator-header h1");
  const creatorSubtitle = cardCreator.querySelector(".creator-header p");
  const editCardId = new URLSearchParams(window.location.search).get("card");
  let activeCardId = editCardId || createId("card");
  let selectedLevel = 8;
  let selectedArt = "underworld";
  let uploadedImage = "";
  let imagePosition = { x: 50, y: 50 };

  const cardTypeLabels = {
    monster: "Monster",
    spell: "Spell",
    trap: "Trap"
  };

  const attributeLabels = {
    monster: "Fire attribute",
    spell: "Spell attribute",
    trap: "Trap attribute"
  };

  function getField(name) {
    return form?.elements[name];
  }

  function getCheckedValue(name) {
    return form?.querySelector(`input[name="${name}"]:checked`)?.value || "";
  }

  function setRadioValue(name, value) {
    const radio = Array.from(form?.querySelectorAll(`input[name="${name}"]`) || [])
      .find((input) => input.value === value);

    if (radio) {
      radio.checked = true;
    }
  }

  function setFieldValue(name, value) {
    const field = getField(name);
    if (!field) {
      return;
    }

    if (field.tagName === "SELECT" && value && !Array.from(field.options).some((option) => option.value === value || option.textContent === value)) {
      field.append(new Option(value, value));
    }

    field.value = value ?? "";
  }

  function usesEffectFields(cardTypeValue, monsterTypeValue) {
    return cardTypeValue !== "monster" || monsterTypeValue === "Effect";
  }

  function usesShortDescription(cardTypeValue, monsterTypeValue) {
    return cardTypeValue === "monster" && monsterTypeValue === "Normal";
  }

  function usesEffectUsage(cardTypeValue, monsterTypeValue) {
    return cardTypeValue === "monster" && monsterTypeValue === "Effect";
  }

  function selectedEffectTemplate() {
    return effectSelect?.value || DEFAULT_EFFECT_TEMPLATE;
  }

  function currentEffectParams() {
    validateEffectLevelRange(true);
    const levelFrom = Math.min(clampEffectLevel(getField("effectLevelFrom")?.value, 1), 4);
    const levelTo = Math.min(clampEffectLevel(getField("effectLevelTo")?.value, 4), 4);

    return {
      levelFrom: String(Math.min(levelFrom, levelTo)),
      levelTo: String(Math.max(levelFrom, levelTo)),
      destination: getField("effectDestination")?.value || "hand",
      source: getField("effectSource")?.value || "hand"
    };
  }

  function currentEffectOutcome() {
    return buildEffectOutcome(selectedEffectTemplate(), currentEffectParams());
  }

  function requiredEffectParamFields(template = selectedEffectTemplate()) {
    if (template === EFFECT_SPECIAL_LEVEL_RANGE) {
      return new Set(["levelFrom", "levelTo"]);
    }

    if (template === EFFECT_SEND_GRAVEYARD_TO_DESTINATION) {
      return new Set(["destination"]);
    }

    if (template === EFFECT_SPECIAL_LEVEL_FOUR_FROM_SOURCE) {
      return new Set(["source"]);
    }

    return new Set();
  }

  function updateEffectParamFields(template = selectedEffectTemplate()) {
    const visibleFields = requiredEffectParamFields(template);

    effectParamFields.forEach((field) => {
      field.hidden = !visibleFields.has(field.dataset.effectParamField);
    });

    if (effectParamPanel) {
      effectParamPanel.hidden = visibleFields.size === 0;
    }

    validateEffectLevelRange(true);
  }

  function setEffectParamValues(params = {}) {
    const levelFrom = Math.min(clampEffectLevel(params.levelFrom, 1), 4);
    const levelTo = Math.min(clampEffectLevel(params.levelTo, 4), 4);
    const normalizedFrom = Math.max(Math.min(levelFrom, levelTo - 1, 3), 1);
    const normalizedTo = Math.min(Math.max(levelTo, normalizedFrom + 1), 4);

    setFieldValue("effectLevelFrom", String(normalizedFrom));
    setFieldValue("effectLevelTo", String(normalizedTo));
    setFieldValue("effectDestination", normalizeHandDeckChoice(params.destination));
    setFieldValue("effectSource", normalizeHandDeckChoice(params.source));
    validateEffectLevelRange(true);
  }

  function validateEffectLevelRange(shouldCorrect = false) {
    const fromField = getField("effectLevelFrom");
    const toField = getField("effectLevelTo");

    if (!fromField || !toField) {
      return true;
    }

    if (selectedEffectTemplate() !== EFFECT_SPECIAL_LEVEL_RANGE) {
      fromField.setCustomValidity("");
      toField.setCustomValidity("");
      Array.from(fromField.options).forEach((option) => {
        option.disabled = false;
      });
      Array.from(toField.options).forEach((option) => {
        option.disabled = false;
      });
      return true;
    }

    const fromLevel = Math.min(clampEffectLevel(fromField.value, 1), 4);
    let toLevel = Math.min(clampEffectLevel(toField.value, 4), 4);
    let correctedFromLevel = fromLevel;

    if (toLevel <= fromLevel) {
      if (shouldCorrect) {
        correctedFromLevel = Math.min(fromLevel, 3);
        toLevel = Math.min(Math.max(toLevel, correctedFromLevel + 1), 4);
        fromField.value = String(correctedFromLevel);
        toField.value = String(toLevel);
      } else {
        const message = "From Level must be lower than To Level.";
        fromField.setCustomValidity(message);
        toField.setCustomValidity(message);
        return false;
      }
    }

    Array.from(fromField.options).forEach((option) => {
      option.disabled = Number(option.value) >= toLevel;
    });

    Array.from(toField.options).forEach((option) => {
      option.disabled = Number(option.value) <= correctedFromLevel;
    });

    fromField.setCustomValidity("");
    toField.setCustomValidity("");
    return correctedFromLevel < toLevel;
  }

  function generatedEffectDescription() {
    const base = combineEffectStatements(getField("effectCause")?.value, currentEffectOutcome());
    if (!base) {
      return "No effect description has been written for this card yet.";
    }
    const oncePerTurn = getField("effectOncePerTurn")?.checked;
    if (oncePerTurn) {
      return `Once per turn, ${base.charAt(0).toLowerCase()}${base.slice(1)}`;
    }
    return base;
  }

  function syncEffectDescription(cardTypeValue = getCheckedValue("cardType") || "monster", monsterTypeValue = getCheckedValue("monsterType") || "Effect") {
    const effectDescription = getField("effectDescription");

    if (!effectDescription || !usesEffectFields(cardTypeValue, monsterTypeValue)) {
      return;
    }

    effectDescription.value = generatedEffectDescription();
  }

  const SPELL_EFFECT_BASE_PARAMS = {
    "draw": ["drawCount"],
    "destroy-opponent-cards": ["destroyCount"],
    "increase-stat": ["statType"],
    "destroy-opponent-monsters": ["destroyCount"],
    "increase-lp": ["lpAmount"],
    "decrease-lp": ["lpAmount"],
    "return-graveyard": ["graveyardType", "graveyardDest"],
    "send-to-graveyard": ["sendCount"],
    "restrict-monster": ["restrictTurns"],
    "restrict-opponent": ["restrictTurns"]
  };

  const TRAP_EFFECT_BASE_PARAMS = {
    "destroy-on-summon": ["trapDestroyCount"],
    "negate-summon": ["trapSummonDest"],
    "boost-on-attack": ["trapStatType"],
    "decrease-attacker": ["trapAtkDecrease"]
  };

  function buildSpellEffectDescription() {
    const effect = spellEffectSelect?.value || "";
    const statType = spellStatTypeSelect?.value || "attack";

    switch (effect) {
      case "special-summon":
        return "Special summon a level 1 to 4 monster from hand.";
      case "draw": {
        const count = getField("spellDrawCount")?.value || "1";
        return count === "1" ? "Draw 1 card from the deck." : `Draw ${count} cards from the deck.`;
      }
      case "destroy-opponent-cards": {
        const count = getField("spellDestroyCount")?.value || "1";
        return count === "1"
          ? "Select and destroy 1 card in the opponent's field."
          : `Select and destroy up to ${count} cards in the opponent's field.`;
      }
      case "increase-stat": {
        const amount = statType === "defense"
          ? getField("spellDefAmount")?.value || "100"
          : getField("spellAtkAmount")?.value || "100";
        return `Increase the ${statType} of a selected monster by ${amount}.`;
      }
      case "destroy-opponent-monsters": {
        const count = getField("spellDestroyCount")?.value || "1";
        return count === "1"
          ? "Select and destroy 1 monster in the opponent's field."
          : `Select and destroy up to ${count} monsters in the opponent's field.`;
      }
      case "destroy-all-monsters":
        return "Destroy all monsters in the opponent's field.";
      case "destroy-all-spell-trap":
        return "Destroy all spell and trap cards in the opponent's field.";
      case "revive":
        return "Revive a monster from your graveyard.";
      case "increase-lp": {
        const amount = getField("spellLpAmount")?.value || "500";
        return `Increase your life points by ${amount}.`;
      }
      case "decrease-lp": {
        const amount = getField("spellLpAmount")?.value || "500";
        return `Decrease the opponent's life points by ${amount}.`;
      }
      case "return-graveyard": {
        const type = getField("spellGraveyardType")?.value || "monster";
        const dest = getField("spellGraveyardDest")?.value || "deck";
        return `Return a ${type} card from your graveyard to the ${dest}.`;
      }
      case "send-to-graveyard": {
        const count = getField("spellSendCount")?.value || "1";
        return count === "1"
          ? "Send 1 card from the opponent's hand to the graveyard."
          : `Send up to ${count} cards from the opponent's hand to the graveyard.`;
      }
      case "restrict-monster": {
        const turns = getField("spellRestrictTurns")?.value || "1";
        return turns === "1"
          ? "Select and restrict 1 opponent's monster from attacking for 1 turn."
          : `Select and restrict 1 opponent's monster from attacking for ${turns} turns.`;
      }
      case "restrict-opponent": {
        const turns = getField("spellRestrictTurns")?.value || "1";
        return turns === "1"
          ? "Restrict the opponent from attacking for 1 turn."
          : `Restrict the opponent from attacking for ${turns} turns.`;
      }
      default:
        return "";
    }
  }

  function buildTrapEffectDescription() {
    const effect = trapEffectSelect?.value || "";
    const statType = trapStatTypeSelect?.value || "attack";

    switch (effect) {
      case "negate-attack":
        return "Negate an attack from an opponent's monster.";
      case "negate-attack-damage":
        return "Negate an attack then inflict damage to the opponent's life points equal to the negated attack points.";
      case "destroy-on-summon": {
        const count = getField("trapDestroyCount")?.value || "1";
        return count === "1"
          ? "When the opponent normal or special summons a monster, select and destroy 1 monster they control, aside from the summoned monster."
          : "When the opponent normal or special summons a monster, select and destroy up to 2 monsters they control, aside from the summoned monster.";
      }
      case "destroy-on-attack":
        return "When the opponent initiated an attack, select and destroy a monster they control, except the attacking monster.";
      case "destroy-weaker":
        return "When the opponent summons a monster, destroy other monsters they control that have attack points lower than the summoned monster. If nothing exists, destroy the summoned monster instead.";
      case "negate-effect":
        return "Negate a card effect from the opponent.";
      case "negate-effect-destroy":
        return "Negate a card effect from the opponent then destroy that card.";
      case "destroy-on-effect":
        return "Destroy an opponent's monster when they use a card effect.";
      case "negate-summon": {
        const dest = getField("trapSummonDest")?.value || "hand";
        return `Negate a summon from the opponent then return it to their ${dest}.`;
      }
      case "boost-on-attack": {
        const amount = statType === "defense"
          ? getField("trapDefBoost")?.value || "100"
          : getField("trapAtkBoost")?.value || "100";
        return `Increase the ${statType} of a monster you control by ${amount} when attacked by the opponent.`;
      }
      case "decrease-attacker": {
        const amount = getField("trapAtkDecrease")?.value || "100";
        return `When an opponent's monster attacked, decrease the attack points of the attacking monster by ${amount}.`;
      }
      default:
        return "";
    }
  }

  function updateTrapEffectParams() {
    const effect = trapEffectSelect?.value || "";
    const statType = trapStatTypeSelect?.value || "attack";
    const baseParams = TRAP_EFFECT_BASE_PARAMS[effect] || [];
    const visibleParams = new Set(baseParams);

    if (effect === "boost-on-attack") {
      visibleParams.add(statType === "defense" ? "trapDefBoost" : "trapAtkBoost");
    }

    trapParamFields.forEach((field) => {
      field.hidden = !visibleParams.has(field.dataset.trapParamField);
    });

    if (trapParamPanel) {
      trapParamPanel.hidden = visibleParams.size === 0;
    }

    const description = buildTrapEffectDescription();
    const descriptionTextarea = getField("trapDescription");

    if (descriptionTextarea) {
      descriptionTextarea.value = description;
    }

    if (trapEffectCount) {
      trapEffectCount.textContent = String(description.length);
    }
  }

  function updateSpellEffectParams() {
    const effect = spellEffectSelect?.value || "";
    const statType = spellStatTypeSelect?.value || "attack";
    const baseParams = SPELL_EFFECT_BASE_PARAMS[effect] || [];
    const visibleParams = new Set(baseParams);

    if (effect === "increase-stat") {
      visibleParams.add(statType === "defense" ? "defAmount" : "atkAmount");
    }

    spellParamFields.forEach((field) => {
      field.hidden = !visibleParams.has(field.dataset.spellParamField);
    });

    if (spellParamPanel) {
      spellParamPanel.hidden = visibleParams.size === 0;
    }

    const description = buildSpellEffectDescription();
    const descriptionTextarea = getField("spellDescription");

    if (descriptionTextarea) {
      descriptionTextarea.value = description;
    }

    if (spellEffectCount) {
      spellEffectCount.textContent = String(description.length);
    }
  }

  function updateDescriptionFields(cardTypeValue = getCheckedValue("cardType") || "monster", monsterTypeValue = getCheckedValue("monsterType") || "Effect") {
    const showMonsterType = cardTypeValue === "monster";
    const showEffectFields = usesEffectFields(cardTypeValue, monsterTypeValue);
    const showShortDescription = usesShortDescription(cardTypeValue, monsterTypeValue);

    if (cardOptionsFieldset) {
      cardOptionsFieldset.hidden = !showMonsterType;
    }

    if (combatStatsFieldset) {
      combatStatsFieldset.hidden = !showMonsterType;
    }

    if (effectDescriptionFieldset) {
      effectDescriptionFieldset.hidden = !showMonsterType;
    }

    if (spellEffectFieldset) {
      spellEffectFieldset.hidden = cardTypeValue !== "spell";
    }

    if (cardTypeValue === "spell") {
      updateSpellEffectParams();
    }

    if (trapEffectFieldset) {
      trapEffectFieldset.hidden = cardTypeValue !== "trap";
    }

    if (cardTypeValue === "trap") {
      updateTrapEffectParams();
    }

    if (cardOptionsLegend) {
      cardOptionsLegend.textContent = showMonsterType ? "Monster Options" : "Card Options";
    }

    if (monsterTypeField) {
      monsterTypeField.hidden = !showMonsterType;
    }

    if (effectTypeField) {
      effectTypeField.hidden = !showEffectFields;
    }

    if (effectBuilderFields) {
      effectBuilderFields.hidden = !showEffectFields;
    }

    if (effectParamPanel && !showEffectFields) {
      effectParamPanel.hidden = true;
    } else if (showEffectFields) {
      updateEffectParamFields();
    }

    if (effectUsageField) {
      effectUsageField.hidden = !usesEffectUsage(cardTypeValue, monsterTypeValue);
    }

    if (effectDescriptionField) {
      effectDescriptionField.hidden = !showEffectFields;
    }

    if (shortDescriptionField) {
      shortDescriptionField.hidden = !showShortDescription;
    }

    if (descriptionLegend) {
      descriptionLegend.textContent = showShortDescription ? "Description" : "Effect / Description";
    }

    if (showEffectFields) {
      syncEffectDescription(cardTypeValue, monsterTypeValue);
    }
  }

  function clampStat(value) {
    const number = Number.parseInt(value, 10);
    if (Number.isNaN(number)) {
      return 0;
    }

    return Math.min(Math.max(number, 0), 9999);
  }

  function getStatLimits(level) {
    if (level <= 4) return { maxAtk: 1800, maxDef: 2200 };
    if (level <= 7) return { maxAtk: 2700, maxDef: 3000 };
    return { maxAtk: 4000, maxDef: 4000 };
  }

  function clampPosition(value) {
    const number = Number.parseFloat(value);
    if (Number.isNaN(number)) {
      return 50;
    }

    return number;
  }

  function clampLevel(value) {
    const number = Number.parseInt(value, 10);
    if (Number.isNaN(number)) {
      return 8;
    }

    return Math.min(Math.max(number, 1), 10);
  }

  function applyImagePosition() {
    const x = `${imagePosition.x}%`;
    const y = `${imagePosition.y}%`;

    [previewArt, imageThumb].forEach((element) => {
      if (!element) {
        return;
      }

      element.style.setProperty("--art-x", x);
      element.style.setProperty("--art-y", y);
    });

    [uploadedArtPreview, uploadedArtThumb].forEach((image) => {
      if (!image) {
        return;
      }

      image.style.setProperty("--art-x", x);
      image.style.setProperty("--art-y", y);
    });

    if (imagePositionX) {
      imagePositionX.value = String(imagePosition.x);
    }

    if (imagePositionY) {
      imagePositionY.value = String(imagePosition.y);
    }
  }

  function setImagePosition(x, y) {
    imagePosition = {
      x: Math.round(clampPosition(x)),
      y: Math.round(clampPosition(y))
    };
    applyImagePosition();
  }

  function renderLevelButtons() {
    if (!levelButtons) {
      return;
    }

    levelButtons.innerHTML = "";

    for (let level = 1; level <= 10; level += 1) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "level-button";
      button.dataset.level = String(level);
      button.setAttribute("aria-label", `Set level ${level}`);
      button.innerHTML = `<span aria-hidden="true"></span><small>${level}</small>`;
      button.classList.toggle("is-selected", level === selectedLevel);
      button.addEventListener("click", () => {
        selectedLevel = level;
        renderLevelButtons();
        filterEffectOptions();
        updateCardPreview();
      });
      levelButtons.append(button);
    }
  }

  const effectSelect = form?.elements["effectOutcome"];
  const effectGroupTemplates = effectSelect
    ? Array.from(effectSelect.querySelectorAll("[data-effect-group]")).map((group) => ({
        label: group.label,
        minLevel: Number(group.dataset.minLevel) || 1,
        options: Array.from(group.querySelectorAll("option")).map((option) => ({
          text: option.textContent,
          value: option.value
        }))
      }))
    : [];

  function filterEffectOptions(preferredValue = effectSelect?.value) {
    if (!effectSelect || effectGroupTemplates.length === 0) {
      return;
    }

    const currentValue = preferredValue || effectSelect.value;
    const fragment = document.createDocumentFragment();
    let firstAllowedOption = null;
    let nextValue = "";

    for (const template of effectGroupTemplates) {
      const allowed = selectedLevel >= template.minLevel;

      if (allowed) {
        const group = document.createElement("optgroup");
        group.label = template.label;
        group.dataset.effectGroup = "";
        group.dataset.minLevel = String(template.minLevel);

        for (const item of template.options) {
          const option = new Option(item.text, item.value);
          group.append(option);

          if (!firstAllowedOption) {
            firstAllowedOption = option;
          }

          if (item.value === currentValue) {
            nextValue = item.value;
          }
        }

        fragment.append(group);
      }
    }

    effectSelect.textContent = "";
    effectSelect.append(fragment);

    if (nextValue) {
      effectSelect.value = nextValue;
    } else if (firstAllowedOption) {
      effectSelect.value = firstAllowedOption.value;
    }

    updateEffectParamFields();
    syncEffectDescription();
  }

  function renderPreviewStars() {
    if (!previewStars) {
      return;
    }

    previewStars.innerHTML = "";
    previewStars.setAttribute("aria-label", `Level ${selectedLevel}`);

    for (let index = 0; index < selectedLevel; index += 1) {
      const star = document.createElement("span");
      previewStars.append(star);
    }
  }

  function resetPlaceholderArt() {
    selectedArt = "underworld";
    uploadedImage = "";
    if (uploadLabel) uploadLabel.hidden = false;
    if (removeImageButton) removeImageButton.hidden = true;
    setImagePosition(50, 50);
    previewArt?.classList.remove("has-upload");
    imageThumb?.classList.remove("has-upload");
    previewArt?.classList.add("art-underworld");
    imageThumb?.classList.add("art-underworld");

    if (previewArt) {
      previewArt.style.backgroundImage = "";
    }

    if (imageThumb) {
      imageThumb.style.backgroundImage = "";
    }

    if (uploadedArtPreview) {
      uploadedArtPreview.removeAttribute("src");
    }

    if (uploadedArtThumb) {
      uploadedArtThumb.removeAttribute("src");
    }
  }

  function applyStoredArtwork(card) {
    const storedPosition = {
      x: card.imagePosition?.x ?? 50,
      y: card.imagePosition?.y ?? 50
    };

    if (!card.uploadedImage) {
      resetPlaceholderArt();
      setImagePosition(storedPosition.x, storedPosition.y);
      return;
    }

    selectedArt = "uploaded";
    uploadedImage = String(card.uploadedImage);
    if (uploadLabel) uploadLabel.hidden = true;
    if (removeImageButton) removeImageButton.hidden = false;
    previewArt?.classList.add("has-upload");
    imageThumb?.classList.add("has-upload");
    previewArt?.classList.add("art-underworld");
    imageThumb?.classList.add("art-underworld");

    if (uploadedArtPreview) {
      uploadedArtPreview.src = uploadedImage;
    }

    if (uploadedArtThumb) {
      uploadedArtThumb.src = uploadedImage;
    }

    setImagePosition(storedPosition.x, storedPosition.y);
  }

  function populateFormFromCard(card) {
    activeCardId = card.id;
    selectedLevel = clampLevel(card.level || 8);
    setRadioValue("cardType", card.cardType || "monster");
    setRadioValue("monsterType", card.monsterType || "Effect");
    setFieldValue("cardName", card.cardName || "");
    setFieldValue("attack", card.attack ?? 0);
    setFieldValue("defense", card.defense ?? 0);
    setFieldValue("effect", card.effect || "");
    setFieldValue("effectCause", card.effectCause || DEFAULT_EFFECT_CAUSE);
    setFieldValue("effectOutcome", cardEffectTemplate(card));
    setEffectParamValues(effectParamsFromCard(card));
    const effectOncePerTurn = getField("effectOncePerTurn");
    if (effectOncePerTurn) {
      effectOncePerTurn.checked = Boolean(card.effectOncePerTurn);
    }
    setFieldValue("effectDescription", cardEffectDescription(card));
    setFieldValue("shortDescription", card.shortDescription || "");
    if (card.cardType === "spell" && card.spellEffectParams) {
      setFieldValue("spellEffect", card.spellEffect || "");
      setFieldValue("spellDrawCount", card.spellEffectParams.drawCount || "1");
      setFieldValue("spellDestroyCount", card.spellEffectParams.destroyCount || "1");
      setFieldValue("spellStatType", card.spellEffectParams.statType || "attack");
      setFieldValue("spellAtkAmount", card.spellEffectParams.atkAmount || "100");
      setFieldValue("spellDefAmount", card.spellEffectParams.defAmount || "100");
      setFieldValue("spellLpAmount", card.spellEffectParams.lpAmount || "500");
      setFieldValue("spellGraveyardType", card.spellEffectParams.graveyardType || "monster");
      setFieldValue("spellGraveyardDest", card.spellEffectParams.graveyardDest || "deck");
      setFieldValue("spellSendCount", card.spellEffectParams.sendCount || "1");
      setFieldValue("spellRestrictTurns", card.spellEffectParams.restrictTurns || "1");
    }
    if (card.cardType === "trap" && card.trapEffectParams) {
      setFieldValue("trapEffect", card.trapEffect || "");
      setFieldValue("trapDestroyCount", card.trapEffectParams.destroyCount || "1");
      setFieldValue("trapSummonDest", card.trapEffectParams.summonDest || "hand");
      setFieldValue("trapStatType", card.trapEffectParams.statType || "attack");
      setFieldValue("trapAtkBoost", card.trapEffectParams.atkBoost || "100");
      setFieldValue("trapDefBoost", card.trapEffectParams.defBoost || "100");
      setFieldValue("trapAtkDecrease", card.trapEffectParams.atkDecrease || "100");
    }
    applyStoredArtwork(card);
    renderLevelButtons();
    filterEffectOptions(cardEffectTemplate(card));
    updateCardPreview();

    if (creatorTitle) {
      creatorTitle.textContent = "Edit Card";
    }

    if (creatorSubtitle) {
      creatorSubtitle.textContent = "Refine your saved creation";
    }

    if (saveButton) {
      saveButton.textContent = "Save Changes";
    }
  }

  async function loadEditableCard() {
    if (!editCardId) {
      return;
    }

    const user = await sessionReady;
    if (!user) {
      return;
    }

    try {
      const cards = await window.BattleOfCreationsStore.getMyCards();
      const editableCard = cards.find((card) => card.id === editCardId);

      if (!editableCard) {
        if (creatorMessage) {
          creatorMessage.textContent = "This card could not be found.";
          creatorMessage.classList.add("is-error");
        }
        return;
      }

      populateFormFromCard(editableCard);
    } catch (error) {
      if (creatorMessage) {
        creatorMessage.textContent = error.message || "This card could not be loaded.";
        creatorMessage.classList.add("is-error");
      }
    }
  }

  function updateCardPreview() {
    if (!form || !previewCard) {
      return;
    }

    const cardType = getCheckedValue("cardType") || "monster";
    const monsterType = getCheckedValue("monsterType") || "Effect";
    filterEffectOptions();
    updateDescriptionFields(cardType, monsterType);
    syncEffectDescription(cardType, monsterType);

    if (cardType === "monster") {
      const limits = getStatLimits(selectedLevel);
      const attackField = getField("attack");
      const defenseField = getField("defense");
      if (attackField) {
        attackField.max = String(limits.maxAtk);
        attackField.placeholder = `Max: ${limits.maxAtk}`;
        if (Number(attackField.value) > limits.maxAtk) {
          attackField.value = String(limits.maxAtk);
        }
      }
      if (defenseField) {
        defenseField.max = String(limits.maxDef);
        defenseField.placeholder = `Max: ${limits.maxDef}`;
        if (Number(defenseField.value) > limits.maxDef) {
          defenseField.value = String(limits.maxDef);
        }
      }
    }

    const cardName = getField("cardName")?.value.trim() || "Unnamed Creation";
    const shortDescription = getField("shortDescription")?.value.trim() || "No description has been written for this card yet.";
    const effectDescription = generatedEffectDescription();
    const attack = clampStat(getField("attack")?.value);
    const defense = clampStat(getField("defense")?.value);
    const displayDescription = cardType === "spell"
      ? buildSpellEffectDescription() || "No effect has been selected for this spell card."
      : cardType === "trap"
        ? buildTrapEffectDescription() || "No effect has been selected for this trap card."
        : usesEffectFields(cardType, monsterType)
          ? effectDescription
          : shortDescription;

    previewCard.classList.remove("card-kind-monster", "card-kind-spell", "card-kind-trap");
    previewCard.classList.add(`card-kind-${cardType}`);

    const artThemeClass = cardType === "spell" ? "art-spell" : cardType === "trap" ? "art-trap" : "art-underworld";
    [previewArt, imageThumb].forEach((el) => {
      if (el) {
        el.classList.remove("art-underworld", "art-spell", "art-trap");
        el.classList.add(artThemeClass);
      }
    });

    if (previewName) {
      previewName.textContent = cardName;
    }

    if (previewAttribute) {
      previewAttribute.setAttribute("aria-label", attributeLabels[cardType]);
    }

    if (previewType) {
      previewType.textContent = cardType === "monster" ? monsterType : cardTypeLabels[cardType];
    }

    if (previewTypeLine) {
      previewTypeLine.textContent = cardType === "monster" ? `Monster / ${monsterType}` : `${cardTypeLabels[cardType]} Card`;
    }

    if (previewDescription) {
      previewDescription.textContent = displayDescription;
    }

    if (previewMetaEl) {
      previewMetaEl.hidden = cardType !== "monster";
    }

    if (previewStatsEl) {
      previewStatsEl.hidden = cardType !== "monster";
    }

    if (previewAttack) {
      previewAttack.textContent = String(attack);
    }

    if (previewDefense) {
      previewDefense.textContent = String(defense);
    }

    if (nameCount) {
      nameCount.textContent = String(getField("cardName")?.value.length || 0);
    }

    if (effectCount) {
      effectCount.textContent = String(getField("effectDescription")?.value.length || 0);
    }

    if (descriptionCount) {
      descriptionCount.textContent = String(getField("shortDescription")?.value.length || 0);
    }

    renderPreviewStars();
  }

  form?.addEventListener("input", updateCardPreview);
  form?.addEventListener("change", updateCardPreview);
  form?.addEventListener("reset", () => {
    window.setTimeout(() => {
      selectedLevel = 8;
      resetPlaceholderArt();
      renderLevelButtons();
      filterEffectOptions();
      updateCardPreview();
      if (creatorMessage) {
        creatorMessage.textContent = "";
      }
    }, 0);
  });
  form?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const user = currentUser || await sessionReady;

    if (!user) {
      if (creatorMessage) {
        creatorMessage.textContent = "Log in before saving cards.";
        creatorMessage.classList.add("is-error");
      }
      window.location.href = "index.html";
      return;
    }

    const draftCardType = getCheckedValue("cardType") || "monster";
    const draftMonsterType = draftCardType === "monster" ? getCheckedValue("monsterType") || "Effect" : "";
    const isSpell = draftCardType === "spell";
    const isTrap = draftCardType === "trap";
    const shouldUseEffectDescription = !isSpell && !isTrap && usesEffectFields(draftCardType, draftMonsterType);
    const shouldUseEffectUsage = !isSpell && !isTrap && usesEffectUsage(draftCardType, draftMonsterType);
    if (shouldUseEffectDescription && !validateEffectLevelRange(false)) {
      form?.reportValidity();
      if (creatorMessage) {
        creatorMessage.textContent = "From Level must be lower than To Level.";
        creatorMessage.classList.add("is-error");
      }
      return;
    }

    const builtEffectTemplate = shouldUseEffectDescription ? selectedEffectTemplate() : "";
    const builtEffectParams = shouldUseEffectDescription ? currentEffectParams() : {};
    const builtEffectOutcome = shouldUseEffectDescription ? buildEffectOutcome(builtEffectTemplate, builtEffectParams) : "";
    const builtEffectDescription = shouldUseEffectDescription ? generatedEffectDescription() : "";

    const draft = {
      id: activeCardId,
      cardType: draftCardType,
      monsterType: draftMonsterType,
      cardName: getField("cardName")?.value || "",
      level: selectedLevel,
      art: selectedArt,
      imagePosition,
      uploadedImage,
      attack: clampStat(getField("attack")?.value),
      defense: clampStat(getField("defense")?.value),
      effect: getField("effect")?.value || "",
      effectCause: shouldUseEffectDescription ? getField("effectCause")?.value || "" : "",
      effectTemplate: builtEffectTemplate,
      effectParams: builtEffectParams,
      effectOutcome: builtEffectOutcome,
      effectOncePerTurn: shouldUseEffectUsage ? Boolean(getField("effectOncePerTurn")?.checked) : false,
      effectDescription: builtEffectDescription,
      shortDescription: usesShortDescription(draftCardType, draftMonsterType) ? getField("shortDescription")?.value || "" : "",
      spellEffect: isSpell ? (getField("spellEffect")?.value || "") : "",
      spellEffectLabel: isSpell ? (spellEffectSelect?.options[spellEffectSelect?.selectedIndex]?.text || "") : "",
      spellEffectParams: isSpell ? {
        drawCount: getField("spellDrawCount")?.value || "1",
        destroyCount: getField("spellDestroyCount")?.value || "1",
        statType: getField("spellStatType")?.value || "attack",
        atkAmount: getField("spellAtkAmount")?.value || "100",
        defAmount: getField("spellDefAmount")?.value || "100",
        lpAmount: getField("spellLpAmount")?.value || "500",
        graveyardType: getField("spellGraveyardType")?.value || "monster",
        graveyardDest: getField("spellGraveyardDest")?.value || "deck",
        sendCount: getField("spellSendCount")?.value || "1",
        restrictTurns: getField("spellRestrictTurns")?.value || "1"
      } : {},
      spellEffectDescription: isSpell ? buildSpellEffectDescription() : "",
      trapEffect: isTrap ? (getField("trapEffect")?.value || "") : "",
      trapEffectLabel: isTrap ? (trapEffectSelect?.options[trapEffectSelect?.selectedIndex]?.text || "") : "",
      trapEffectParams: isTrap ? {
        destroyCount: getField("trapDestroyCount")?.value || "1",
        summonDest: getField("trapSummonDest")?.value || "hand",
        statType: getField("trapStatType")?.value || "attack",
        atkBoost: getField("trapAtkBoost")?.value || "100",
        defBoost: getField("trapDefBoost")?.value || "100",
        atkDecrease: getField("trapAtkDecrease")?.value || "100"
      } : {},
      trapEffectDescription: isTrap ? buildTrapEffectDescription() : "",
      savedAt: new Date().toISOString()
    };

    if (creatorMessage) {
      creatorMessage.textContent = "Saving card...";
      creatorMessage.classList.remove("is-error");
    }

    try {
      const savedCard = await window.BattleOfCreationsStore.saveCard(draft);

      if (creatorMessage) {
        creatorMessage.textContent = `Card saved for ${savedCard.ownerUsername || user.username}. Opening your cards...`;
      }
      window.location.href = `cards.html?card=${encodeURIComponent(savedCard.id)}`;
    } catch (error) {
      if (creatorMessage) {
        creatorMessage.textContent = error.message || "The card could not be saved.";
        creatorMessage.classList.add("is-error");
      }
    }
  });

  imagePositionX?.addEventListener("input", () => {
    setImagePosition(imagePositionX.value, imagePosition.y);
  });

  imagePositionY?.addEventListener("input", () => {
    setImagePosition(imagePosition.x, imagePositionY.value);
  });

  centerImageButton?.addEventListener("click", () => {
    setImagePosition(50, 50);
  });

  function bindArtworkDrag(element) {
    if (!element) {
      return;
    }

    let dragStart = null;

    element.addEventListener("pointerdown", (event) => {
      if (event.button !== 0) {
        return;
      }

      const rect = element.getBoundingClientRect();
      dragStart = {
        pointerX: event.clientX,
        pointerY: event.clientY,
        startX: imagePosition.x,
        startY: imagePosition.y,
        width: rect.width || 1,
        height: rect.height || 1
      };
      element.classList.add("is-dragging");
      element.setPointerCapture?.(event.pointerId);
      event.preventDefault();
    });

    element.addEventListener("pointermove", (event) => {
      if (!dragStart) {
        return;
      }

      const deltaX = ((event.clientX - dragStart.pointerX) / dragStart.width) * 100;
      const deltaY = ((event.clientY - dragStart.pointerY) / dragStart.height) * 100;
      setImagePosition(dragStart.startX + deltaX, dragStart.startY + deltaY);
    });

    element.addEventListener("pointerup", (event) => {
      dragStart = null;
      element.classList.remove("is-dragging");
      element.releasePointerCapture?.(event.pointerId);
    });

    element.addEventListener("pointercancel", () => {
      dragStart = null;
      element.classList.remove("is-dragging");
    });
  }

  bindArtworkDrag(previewArt);
  bindArtworkDrag(imageThumb);

  function setUploadedImage(src) {
    uploadedImage = src;
    selectedArt = src ? "uploaded" : "underworld";

    if (uploadLabel) uploadLabel.hidden = !!src;
    if (removeImageButton) removeImageButton.hidden = !src;

    if (previewArt) previewArt.classList.toggle("has-upload", !!src);
    if (imageThumb) imageThumb.classList.toggle("has-upload", !!src);

    if (uploadedArtPreview) uploadedArtPreview.src = src || "";
    if (uploadedArtThumb) uploadedArtThumb.src = src || "";

    if (imageUpload) imageUpload.value = "";
    applyImagePosition();
  }

  imageUpload?.addEventListener("change", () => {
    const file = imageUpload.files?.[0];
    if (!file) {
      return;
    }

    const reader = new FileReader();
    reader.addEventListener("load", () => {
      setImagePosition(50, 50);
      setUploadedImage(String(reader.result));
    });
    reader.readAsDataURL(file);
  });

  removeImageButton?.addEventListener("click", () => {
    setUploadedImage("");
  });

  renderLevelButtons();
  filterEffectOptions();
  applyImagePosition();
  updateCardPreview();
  loadEditableCard();
}

// ===== Lobby =====
const lobbyEl = document.querySelector("[data-lobby]");

if (lobbyEl) {
  const LOBBY_PAGE_SIZE = 10;

  // Room data — populated via API when backend supports rooms
  const MOCK_ROOMS = [];

  const rankedTbody      = lobbyEl.querySelector("[data-ranked-rooms]");
  const unrankedTbody    = lobbyEl.querySelector("[data-unranked-rooms]");
  const rankedPagNav     = lobbyEl.querySelector("[data-ranked-pagination]");
  const unrankedPagNav   = lobbyEl.querySelector("[data-unranked-pagination]");
  const roomSearchInput  = lobbyEl.querySelector("[data-room-search]");
  const createRoomBtn    = lobbyEl.querySelector("[data-create-room]");
  const joinRoomBtn      = lobbyEl.querySelector("[data-join-room]");

  let rankedPage   = 1;
  let unrankedPage = 1;

  function lobbyFilteredRooms(ranked) {
    const query = String(roomSearchInput?.value || "").trim().toLowerCase();
    return MOCK_ROOMS.filter((r) => {
      if (r.ranked !== ranked) return false;
      if (!query) return true;
      return r.name.toLowerCase().includes(query) || r.creator.toLowerCase().includes(query);
    });
  }

  function lobbyRenderRows(tbody, rooms, page) {
    if (!tbody) return;
    tbody.textContent = "";
    const total     = rooms.length;
    const pageCount = Math.max(1, Math.ceil(total / LOBBY_PAGE_SIZE));
    const safePage  = Math.min(Math.max(page, 1), pageCount);
    const start     = (safePage - 1) * LOBBY_PAGE_SIZE;
    const pageRooms = rooms.slice(start, start + LOBBY_PAGE_SIZE);

    if (pageRooms.length === 0) {
      const tr = document.createElement("tr");
      const td = document.createElement("td");
      td.colSpan = 6;
      td.className = "lobby-table-empty";
      td.textContent = "No rooms found.";
      tr.append(td);
      tbody.append(tr);
      return safePage;
    }

    pageRooms.forEach((room) => {
      const isFull = room.status === "full";
      const tr = document.createElement("tr");

      // Room name
      const nameTd = document.createElement("td");
      const nameCell = document.createElement("span");
      nameCell.className = "lobby-room-name-cell";
      const dot = document.createElement("span");
      dot.className = "lobby-room-dot";
      nameCell.append(dot, document.createTextNode(room.name));
      nameTd.append(nameCell);

      // Creator
      const creatorTd = document.createElement("td");
      creatorTd.textContent = room.creator;

      // Players
      const playersTd = document.createElement("td");
      playersTd.textContent = `${room.players}/${room.maxPlayers}`;

      // Mode
      const modeTd = document.createElement("td");
      modeTd.textContent = room.mode;

      // Status
      const statusTd = document.createElement("td");
      const statusSpan = document.createElement("span");
      statusSpan.textContent = isFull ? "Full" : "Waiting";
      statusSpan.className   = isFull ? "lobby-status-full" : "lobby-status-waiting";
      statusTd.append(statusSpan);

      // Join button
      const actionTd = document.createElement("td");
      const joinBtn  = document.createElement("button");
      joinBtn.type      = "button";
      joinBtn.className = "lobby-join-btn";
      joinBtn.textContent = "JOIN";
      joinBtn.disabled  = isFull;
      joinBtn.addEventListener("click", () => lobbyHandleJoin(room));
      actionTd.append(joinBtn);

      tr.append(nameTd, creatorTd, playersTd, modeTd, statusTd, actionTd);
      tbody.append(tr);
    });

    return safePage;
  }

  function lobbyRenderPagination(nav, rooms, currentPage, onPageChange) {
    if (!nav) return;
    nav.textContent = "";
    const total     = rooms.length;
    const pageCount = Math.max(1, Math.ceil(total / LOBBY_PAGE_SIZE));

    function mkBtn(label, page, isActive, disabled) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "lobby-page-btn" + (isActive ? " is-active" : "");
      btn.textContent = label;
      btn.disabled = disabled;
      if (!disabled) btn.addEventListener("click", () => onPageChange(page));
      return btn;
    }

    nav.append(mkBtn("«", 1, false, currentPage === 1));
    for (let p = 1; p <= pageCount; p++) {
      nav.append(mkBtn(String(p), p, p === currentPage, false));
    }
    nav.append(mkBtn("»", pageCount, false, currentPage === pageCount));
  }

  function lobbyRender() {
    const ranked   = lobbyFilteredRooms(true);
    const unranked = lobbyFilteredRooms(false);
    rankedPage   = lobbyRenderRows(rankedTbody, ranked, rankedPage);
    unrankedPage = lobbyRenderRows(unrankedTbody, unranked, unrankedPage);
    lobbyRenderPagination(rankedPagNav, ranked, rankedPage, (p) => { rankedPage = p; lobbyRender(); });
    lobbyRenderPagination(unrankedPagNav, unranked, unrankedPage, (p) => { unrankedPage = p; lobbyRender(); });
  }

  function lobbyHandleJoin(room) {
    // Placeholder: navigate to game room or show deck selection dialog
    alert(`Joining "${room.name}" — this feature is coming soon!`);
  }

  roomSearchInput?.addEventListener("input", () => {
    rankedPage = 1;
    unrankedPage = 1;
    lobbyRender();
  });

  createRoomBtn?.addEventListener("click", () => {
    alert("Create Room — this feature is coming soon!");
  });

  joinRoomBtn?.addEventListener("click", () => {
    roomSearchInput?.focus();
  });

  lobbyRender();
}

// === Duel Mode Dialog ===
(function initDuelModeDialog() {
  const triggers = Array.from(document.querySelectorAll("[data-duel-now]"));
  if (!triggers.length) return;

  const backdrop = document.createElement("div");
  backdrop.className = "duel-dialog-backdrop";
  backdrop.setAttribute("role", "dialog");
  backdrop.setAttribute("aria-modal", "true");
  backdrop.setAttribute("aria-labelledby", "duel-dialog-title");
  backdrop.innerHTML = `
    <div class="duel-dialog">
      <button class="duel-dialog-close" aria-label="Close" type="button">&#x2715;</button>

      <div class="duel-dialog-icon">
        <svg width="54" height="54" viewBox="0 0 54 54" fill="none" aria-hidden="true">
          <polygon points="27,4 50,15 50,39 27,50 4,39 4,15" fill="none" stroke="#c9a84c" stroke-width="1.5" opacity="0.5"/>
          <line x1="27" y1="8" x2="27" y2="46" stroke="#c9a84c" stroke-width="1.5" stroke-linecap="round" opacity="0.4"/>
          <path d="M27 10 L32 22 L27 20 L22 22 Z" fill="#ff4e2e" opacity="0.9"/>
          <rect x="25.5" y="20" width="3" height="20" rx="1" fill="url(#blade)" opacity="0.9"/>
          <rect x="20" y="27" width="14" height="2" rx="1" fill="#c9a84c" opacity="0.8"/>
          <defs>
            <linearGradient id="blade" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stop-color="#ffe8b0"/>
              <stop offset="100%" stop-color="#a45a28"/>
            </linearGradient>
          </defs>
        </svg>
      </div>

      <h2 class="duel-dialog-title" id="duel-dialog-title">Select Game Mode</h2>
      <p class="duel-dialog-sub">Choose how you want to battle</p>

      <div class="duel-dialog-options">
        <button class="duel-dialog-option" type="button" data-duel-mode="online">
          <span class="duel-dialog-opt-label">Online</span>
          <span class="duel-dialog-opt-sub">Battle real players in the lobby</span>
        </button>
        <button class="duel-dialog-option" type="button" data-duel-mode="ai">
          <span class="duel-dialog-opt-label">Vs AI</span>
          <span class="duel-dialog-opt-sub">Train against the computer</span>
        </button>
      </div>
    </div>
  `;
  document.body.appendChild(backdrop);

  const dialog = backdrop.querySelector(".duel-dialog");
  const closeBtn = backdrop.querySelector(".duel-dialog-close");

  function openDialog() {
    backdrop.classList.add("is-open");
    closeBtn.focus();
  }

  function closeDialog() {
    backdrop.classList.remove("is-open");
  }

  triggers.forEach(trigger => {
    trigger.addEventListener("click", openDialog);
  });

  closeBtn.addEventListener("click", closeDialog);

  backdrop.addEventListener("click", (e) => {
    if (!dialog.contains(e.target)) closeDialog();
  });

  backdrop.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeDialog();

    // Trap focus inside dialog
    if (e.key === "Tab") {
      const focusable = Array.from(dialog.querySelectorAll("button, [tabindex]")).filter(el => !el.disabled);
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }
  });

  backdrop.addEventListener("click", (e) => {
    const option = e.target.closest("[data-duel-mode]");
    if (!option) return;
    closeDialog();
    if (option.dataset.duelMode === "online") {
      if (window.location.pathname.endsWith("lobby.html")) {
        closeDialog();
      } else {
        window.location.href = "lobby.html";
      }
    } else {
      window.location.href = "battle.html";
    }
  });
})();

// ============================================================
// BATTLEFIELD  (battle.html)
// ============================================================
(function initBattlefield() {
  if (!document.querySelector("[data-battle]")) return;

  const store = window.BattleOfCreationsStore;

  // ── Helpers ──────────────────────────────────────────────
  function shuffle(arr) {
    const a = [...arr];
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  function cardTypeName(card) {
    const t = String(card.cardType || "monster").toLowerCase();
    return ["monster", "spell", "trap"].includes(t) ? t : "monster";
  }

  function cardAtk(card) { return Number(card.attackPoints  ?? card.attack  ?? 0); }
  function cardDef(card) { return Number(card.defensePoints ?? card.defense ?? 0); }
  function baseCardAtk(card) { return Number(card?._baseAttackPoints ?? card?.attack ?? card?.attackPoints ?? 0); }
  function baseCardDef(card) { return Number(card?._baseDefensePoints ?? card?.defense ?? card?.defensePoints ?? 0); }
  function cardLevel(card) { return Number(card.level) || 1; }
  function cardNameStr(card) { return String(card.cardName || "Unnamed"); }
  function duelCardId(card) {
    if (!card) return "";
    if (!card._duelUid) card._duelUid = createId("duel-card");
    return card._duelUid;
  }
  function sameDuelCard(a, b) {
    return Boolean(a && b && duelCardId(a) === duelCardId(b));
  }
  function createDuelCard(card) {
    return {
      ...card,
      effectParams: { ...(card?.effectParams || {}) },
      spellEffectParams: { ...(card?.spellEffectParams || {}) },
      trapEffectParams: { ...(card?.trapEffectParams || {}) },
      imagePosition: { ...(card?.imagePosition || {}) },
      _baseAttackPoints: Number(card?.attackPoints ?? card?.attack ?? 0),
      _baseDefensePoints: Number(card?.defensePoints ?? card?.defense ?? 0),
      _duelUid: createId("duel-card")
    };
  }
  function markSpellStatBoost(card) {
    if (!card || !isMonsterCard(card)) return;
    if (!Number.isFinite(Number(card._baseAttackPoints))) card._baseAttackPoints = cardAtk(card);
    if (!Number.isFinite(Number(card._baseDefensePoints))) card._baseDefensePoints = cardDef(card);
    card._spellStatBoosted = true;
  }
  function resetSpellStatBoostOnRevive(card) {
    if (!card?._spellStatBoosted) return card;
    card.attackPoints = baseCardAtk(card);
    card.defensePoints = baseCardDef(card);
    delete card._spellStatBoosted;
    delete card._temporaryStatEffects;
    return card;
  }
  function tributeRequirement(card) {
    const level = cardLevel(card);
    if (level >= 8) return 2;
    if (level >= 5) return 1;
    return 0;
  }

  function artStyle(card) {
    // position fallback — still used for background-type variants
    const t = cardTypeName(card);
    if (t === "spell") return "background:linear-gradient(135deg,#0c3318,#081a0a);";
    if (t === "trap")  return "background:linear-gradient(135deg,#2d1040,#0f0516);";
    return "background:linear-gradient(135deg,#3d1205,#1a0704);";
  }

  // Build an art element — uses <img> when the card has an uploaded image,
  // falls back to a type-tinted div otherwise.
  function makeArtEl(card, className) {
    const wrap = document.createElement("div");
    wrap.className = className;

    if (card.uploadedImage) {
      const img = document.createElement("img");
      img.src   = card.uploadedImage;
      img.alt   = "";
      img.className = "bf-art-img";
      // imagePosition is stored as { x, y } — artX/artY are not a field
      const pos = card.imagePosition || {};
      const x   = Number(pos.x) || 50;
      const y   = Number(pos.y) || 50;
      img.style.objectPosition = `${x}% ${y}%`;
      wrap.appendChild(img);
    } else {
      wrap.style.cssText = artStyle(card);
    }

    return wrap;
  }

  // ── Game state ───────────────────────────────────────────
  const state = {
    turn: 1,
    activePlayer: "player",   // "player" | "ai" | "none"
    startingPlayer: "player",
    phase: "draw",            // draw | main1 | battle | main2 | end
    playerLP: 8000,
    aiLP: 8000,
    playerHand: [],
    aiHand: [],
    playerDeck: [],
    aiDeck: [],
    playerGY: [],
    aiGY: [],
    playerMonster:   [null, null, null, null, null],
    playerSpellTrap: [null, null, null, null, null],
    aiMonster:       [null, null, null, null, null],
    aiSpellTrap:     [null, null, null, null, null],
    selectedHandIdx: null,
    pendingAction: null,
    pendingSpell: null,
    pendingFieldSelection: null,
    resolvingSpell: false,
    selectedAttackIdx: null,
    tributesPending: 0,
    tributesSelected: [],
    hasNormalSummoned: false,
    hasDrawn: false,
    battleEnteredThisTurn: false,
    monstersAttackedThisTurn: new Set(),
    monsterAttackCountsThisTurn: new Map(),
    monstersChangedModeThisTurn: new Set(),
    effectMonsterUsesThisTurn: new Set(),
    effectMonsterUsesEver: new Set(),
    aiBattleRestrictedUntilTurn: 0,
    resolvingEffectMonster: false,
    resolvingTrap: false,
    resolvingBattle: false,
    resultSfxPlayed: false,
    defeatedOwner: null
  };
  let duelDeckCards = [];
  let duelSetupDecks = [];
  let duelSetupCardMap = {};
  let selectedDuelDeckId = "";

  // ── DOM references ────────────────────────────────────────
  const $ = (sel) => document.querySelector(sel);
  const turnEl          = $("[data-bf-turn]");
  const playerLpEl      = $("[data-player-lp]");
  const aiLpEl          = $("[data-ai-lp]");
  const playerLpFill    = $("[data-player-lp-fill]");
  const aiLpFill        = $("[data-ai-lp-fill]");
  const playerHandEl    = $("[data-player-hand]");
  const aiHandEl        = $("[data-ai-hand]");
  const playerDeckCount = $("[data-player-deck-count]");
  const aiDeckCount     = $("[data-ai-deck-count]");
  const playerDeckPile  = $("[data-player-deck]");
  const aiDeckPile      = $("[data-ai-deck]");
  const playerGYCount   = $("[data-player-gy-count]");
  const aiGYCount       = $("[data-ai-gy-count]");
  const playerGYSlot    = $("[data-player-gy]");
  const aiGYSlot        = $("[data-ai-gy]");
  const gyDialogEl      = $("[data-gy-dialog]");
  const gyOwnerEl       = $("[data-gy-owner]");
  const gyTitleEl       = $("[data-gy-title]");
  const gyTableBodyEl   = $("[data-gy-table-body]");
  const gyCloseBtn      = $("[data-gy-close]");
  const playerMonZone   = $("[data-player-monster]");
  const playerSTZone    = $("[data-player-spelltrap]");
  const aiMonZone       = $("[data-ai-monster]");
  const aiSTZone        = $("[data-ai-spelltrap]");
  const statusEl        = $("[data-bf-status]");
  const statusMsgEl     = $("[data-bf-status-msg]");
  const endTurnBtn      = $("[data-bf-end-turn]");
  const sidebarToggleBtn = $("[data-bf-sidebar-toggle]");
  const sidebarBackdrop = $("[data-bf-sidebar-backdrop]");
  const sidebarEl       = $("[data-bf-sidebar]");
  const battlePageEl    = $(".bf-page");
  const surrenderBtn    = $("[data-bf-surrender]");
  const usernameEl      = $("[data-bf-username]");
  const phaseButtons    = Array.from(document.querySelectorAll("[data-bf-phase]"));
  const drawPromptEl    = $("[data-draw-prompt]");
  const battleLogListEl = $("[data-battle-log-list]");
  const battleLogEmptyEl = $("[data-battle-log-empty]");
  const resultOverlayEl = $("[data-result-overlay]");
  const resultTitleEl   = $("[data-result-title]");
  const resultSubtitleEl = $("[data-result-subtitle]");
  const resultRematchBtn = $("[data-result-rematch]");
  const resultExitBtn    = $("[data-result-exit]");

  const compactViewport = window.matchMedia("(max-width: 760px)");
  let sidebarViewportIsCompact = compactViewport.matches;

  function isCompactInteractionMode() {
    return window.matchMedia("(max-width: 760px), (hover: none), (pointer: coarse)").matches;
  }

  function sidebarIsVisible() {
    if (!battlePageEl) return false;
    return compactViewport.matches
      ? battlePageEl.classList.contains("is-sidebar-open")
      : !battlePageEl.classList.contains("is-sidebar-collapsed");
  }

  function updateSidebarState() {
    const visible = sidebarIsVisible();
    sidebarToggleBtn?.setAttribute("aria-expanded", visible ? "true" : "false");
    sidebarEl?.setAttribute("aria-hidden", visible ? "false" : "true");
    if (sidebarEl) sidebarEl.inert = !visible;
  }

  function closeMobileSidebar() {
    if (!compactViewport.matches || !battlePageEl) return;
    battlePageEl.classList.remove("is-sidebar-open");
    updateSidebarState();
  }

  function toggleSidebar() {
    if (!battlePageEl) return;
    if (compactViewport.matches) {
      battlePageEl.classList.toggle("is-sidebar-open");
    } else {
      battlePageEl.classList.toggle("is-sidebar-collapsed");
    }
    updateSidebarState();
  }

  function syncSidebarViewport() {
    const nextCompact = compactViewport.matches;
    if (nextCompact !== sidebarViewportIsCompact) {
      battlePageEl?.classList.remove("is-sidebar-open", "is-sidebar-collapsed");
      sidebarViewportIsCompact = nextCompact;
    }
    updateSidebarState();
  }

  sidebarToggleBtn?.addEventListener("click", toggleSidebar);
  sidebarBackdrop?.addEventListener("click", closeMobileSidebar);
  compactViewport.addEventListener?.("change", syncSidebarViewport);
  updateSidebarState();

  function duelDeckName(deck) {
    return String(deck?.name || deck?.deckName || "Unnamed Deck");
  }

  function duelDeckCardIds(deck) {
    return Array.isArray(deck?.cardIds) ? deck.cardIds : [];
  }

  function duelDeckCardsFor(deck, cardMap = duelSetupCardMap) {
    return duelDeckCardIds(deck)
      .map((id) => cardMap[id])
      .filter(Boolean);
  }

  function duelDeckComposition(cards) {
    return cards.reduce((counts, card) => {
      const type = cardTypeName(card);
      counts[type] = (counts[type] || 0) + 1;
      return counts;
    }, { monster: 0, spell: 0, trap: 0 });
  }

  function duelDeckSavedLabel(deck) {
    const raw = deck?.savedAt || deck?.updatedAt || deck?.createdAt;
    if (!raw) return "-";
    const date = new Date(raw);
    if (Number.isNaN(date.getTime())) return "-";
    return date.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
  }

  function removePreDuelOverlay(overlay, onKeydown) {
    if (onKeydown) document.removeEventListener("keydown", onKeydown);
    overlay?.remove();
  }

  function createPreDuelOverlay(panelClass = "") {
    const overlay = document.createElement("div");
    overlay.className = "bf-preduel-overlay";
    overlay.setAttribute("role", "dialog");
    overlay.setAttribute("aria-modal", "true");

    const panel = document.createElement("div");
    panel.className = `bf-preduel-panel ${panelClass}`.trim();
    overlay.appendChild(panel);
    document.body.appendChild(overlay);
    requestAnimationFrame(() => overlay.classList.add("is-open"));
    return { overlay, panel };
  }

  function appendPreDuelHead(panel, kickerText, titleText) {
    const head = document.createElement("div");
    head.className = "bf-preduel-head";

    const kicker = document.createElement("div");
    kicker.className = "bf-preduel-kicker";
    kicker.textContent = kickerText;

    const title = document.createElement("h2");
    title.className = "bf-preduel-title";
    title.textContent = titleText;

    head.append(kicker, title);
    panel.appendChild(head);
    return head;
  }

  function promptDuelDeckChoice(decks, cardMap) {
    return new Promise((resolve) => {
      const validDecks = decks.filter((deck) => duelDeckCardsFor(deck, cardMap).length > 0);
      let selectedId = validDecks.some((deck) => deck.id === selectedDuelDeckId)
        ? selectedDuelDeckId
        : validDecks[0]?.id || "";
      const { overlay, panel } = createPreDuelOverlay("bf-deck-choice-panel");
      overlay.setAttribute("aria-label", "Choose duel deck");
      appendPreDuelHead(panel, "Duel Setup", "Choose Your Deck");

      const wrap = document.createElement("div");
      wrap.className = "bf-preduel-table-wrap";
      const table = document.createElement("table");
      table.className = "bf-preduel-deck-table";
      table.innerHTML = `
        <thead>
          <tr>
            <th scope="col">Deck</th>
            <th scope="col">Cards</th>
            <th scope="col">Mon</th>
            <th scope="col">Spell</th>
            <th scope="col">Trap</th>
            <th scope="col">Saved</th>
            <th scope="col" class="is-select">Pick</th>
          </tr>
        </thead>
      `;

      const tbody = document.createElement("tbody");
      decks.forEach((deck) => {
        const cards = duelDeckCardsFor(deck, cardMap);
        const counts = duelDeckComposition(cards);
        const disabled = cards.length === 0;
        const row = document.createElement("tr");
        row.className = disabled ? "is-disabled" : "";
        row.dataset.deckId = deck.id || "";

        const nameTd = document.createElement("td");
        nameTd.className = "bf-preduel-deck-name";
        nameTd.textContent = duelDeckName(deck);

        const countTd = document.createElement("td");
        countTd.textContent = String(cards.length);

        const monsterTd = document.createElement("td");
        monsterTd.textContent = String(counts.monster || 0);

        const spellTd = document.createElement("td");
        spellTd.textContent = String(counts.spell || 0);

        const trapTd = document.createElement("td");
        trapTd.textContent = String(counts.trap || 0);

        const savedTd = document.createElement("td");
        savedTd.textContent = duelDeckSavedLabel(deck);

        const pickTd = document.createElement("td");
        pickTd.className = "bf-preduel-pick-cell";
        const label = document.createElement("label");
        label.className = "bf-deck-choice-check";
        const input = document.createElement("input");
        input.className = "bf-deck-choice-input";
        input.type = "radio";
        input.name = "duel-deck-choice";
        input.value = deck.id || "";
        input.disabled = disabled;
        input.checked = !disabled && deck.id === selectedId;
        input.setAttribute("aria-label", `Use ${duelDeckName(deck)}`);
        const mark = document.createElement("span");
        mark.className = "bf-deck-choice-mark";
        label.append(input, mark);
        pickTd.appendChild(label);

        function selectRow() {
          if (disabled) return;
          selectedId = deck.id || "";
          tbody.querySelectorAll("tr").forEach((tr) => tr.classList.toggle("is-selected", tr.dataset.deckId === selectedId));
          tbody.querySelectorAll(".bf-deck-choice-input").forEach((radio) => {
            radio.checked = radio.value === selectedId;
          });
          startBtn.disabled = !selectedId;
        }

        row.addEventListener("click", selectRow);
        row.addEventListener("keydown", (event) => {
          if (event.key !== "Enter" && event.key !== " ") return;
          event.preventDefault();
          selectRow();
        });
        input.addEventListener("change", selectRow);
        if (!disabled) row.tabIndex = 0;
        row.classList.toggle("is-selected", !disabled && deck.id === selectedId);
        row.append(nameTd, countTd, monsterTd, spellTd, trapTd, savedTd, pickTd);
        tbody.appendChild(row);
      });

      table.appendChild(tbody);
      wrap.appendChild(table);

      if (!validDecks.length) {
        const empty = document.createElement("div");
        empty.className = "bf-preduel-empty";
        empty.textContent = "No playable decks found.";
        wrap.appendChild(empty);
      }

      const actions = document.createElement("div");
      actions.className = "bf-preduel-actions";

      const homeBtn = document.createElement("button");
      homeBtn.type = "button";
      homeBtn.className = "bf-preduel-btn";
      homeBtn.textContent = "Home";
      homeBtn.addEventListener("click", () => {
        removePreDuelOverlay(overlay, onKeydown);
        resolve(null);
      });

      const startBtn = document.createElement("button");
      startBtn.type = "button";
      startBtn.className = "bf-preduel-btn is-primary";
      startBtn.textContent = "Continue";
      startBtn.disabled = !selectedId;
      startBtn.addEventListener("click", () => {
        const deck = decks.find((candidate) => candidate.id === selectedId);
        const cards = duelDeckCardsFor(deck, cardMap);
        if (!deck || !cards.length) return;
        selectedDuelDeckId = selectedId;
        removePreDuelOverlay(overlay, onKeydown);
        resolve({ deck, cards });
      });

      actions.append(homeBtn, startBtn);
      panel.append(wrap, actions);

      function onKeydown(event) {
        if (event.key === "Escape") homeBtn.focus();
      }

      document.addEventListener("keydown", onKeydown);
      window.setTimeout(() => {
        const selectedRow = panel.querySelector("tr.is-selected");
        if (selectedRow) selectedRow.focus();
        else homeBtn.focus();
      }, 60);
    });
  }

  const RPS_CHOICES = ["rock", "paper", "scissors"];
  const RPS_BEATS = { rock: "scissors", paper: "rock", scissors: "paper" };

  function rpsLabel(choice) {
    return choice ? choice.charAt(0).toUpperCase() + choice.slice(1) : "";
  }

  function rpsWinner(playerChoice, aiChoice) {
    if (playerChoice === aiChoice) return "tie";
    return RPS_BEATS[playerChoice] === aiChoice ? "player" : "ai";
  }

  function promptRockPaperScissors() {
    return new Promise((resolve) => {
      const { overlay, panel } = createPreDuelOverlay("bf-rps-panel");
      overlay.setAttribute("aria-label", "Rock paper scissors");
      appendPreDuelHead(panel, "First Turn", "Rock Paper Scissors");

      const arena = document.createElement("div");
      arena.className = "bf-rps-arena";

      const playerToken = document.createElement("div");
      playerToken.className = "bf-rps-token";
      playerToken.innerHTML = `<span>You</span><strong>?</strong>`;

      const versus = document.createElement("div");
      versus.className = "bf-rps-versus";
      versus.textContent = "VS";

      const aiToken = document.createElement("div");
      aiToken.className = "bf-rps-token";
      aiToken.innerHTML = `<span>AI</span><strong>?</strong>`;

      arena.append(playerToken, versus, aiToken);

      const choices = document.createElement("div");
      choices.className = "bf-rps-choices";
      const result = document.createElement("div");
      result.className = "bf-rps-result";
      result.textContent = "Choose your sign.";

      let busy = false;
      RPS_CHOICES.forEach((choice) => {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "bf-rps-choice";
        btn.dataset.rpsChoice = choice;
        btn.innerHTML = `<span>${choice.charAt(0).toUpperCase()}</span><strong>${rpsLabel(choice)}</strong>`;
        btn.addEventListener("click", () => {
          if (busy) return;
          busy = true;
          choices.querySelectorAll("button").forEach((button) => { button.disabled = true; });
          const aiChoice = RPS_CHOICES[Math.floor(Math.random() * RPS_CHOICES.length)];
          const winner = rpsWinner(choice, aiChoice);
          playerToken.querySelector("strong").textContent = rpsLabel(choice);
          aiToken.querySelector("strong").textContent = rpsLabel(aiChoice);

          if (winner === "tie") {
            result.textContent = `Both chose ${rpsLabel(choice)}. Try again.`;
            window.setTimeout(() => {
              playerToken.querySelector("strong").textContent = "?";
              aiToken.querySelector("strong").textContent = "?";
              result.textContent = "Choose again.";
              busy = false;
              choices.querySelectorAll("button").forEach((button) => { button.disabled = false; });
            }, 900);
            return;
          }

          result.textContent = winner === "player"
            ? `You chose ${rpsLabel(choice)}. AI chose ${rpsLabel(aiChoice)}. You choose who goes first.`
            : `You chose ${rpsLabel(choice)}. AI chose ${rpsLabel(aiChoice)}. AI chooses who goes first.`;
          window.setTimeout(() => {
            removePreDuelOverlay(overlay);
            resolve(winner);
          }, 1250);
        });
        choices.appendChild(btn);
      });

      panel.append(arena, choices, result);
      window.setTimeout(() => choices.querySelector("button")?.focus(), 60);
    });
  }

  function promptPlayerFirstChoice() {
    return new Promise((resolve) => {
      const { overlay, panel } = createPreDuelOverlay("bf-first-player-panel");
      overlay.setAttribute("aria-label", "Choose who goes first");
      appendPreDuelHead(panel, "RPS Winner", "Choose First Player");

      const message = document.createElement("div");
      message.className = "bf-preduel-message";
      message.textContent = "You won the throw. Choose who takes the first turn.";

      const actions = document.createElement("div");
      actions.className = "bf-first-player-options";

      [["You Go First", "player"], ["AI Goes First", "ai"]].forEach(([label, owner]) => {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "bf-preduel-btn is-primary";
        btn.textContent = label;
        btn.addEventListener("click", () => {
          removePreDuelOverlay(overlay);
          resolve(owner);
        });
        actions.appendChild(btn);
      });

      panel.append(message, actions);
      window.setTimeout(() => actions.querySelector("button")?.focus(), 60);
    });
  }

  function promptAiFirstChoice() {
    return new Promise((resolve) => {
      const { overlay, panel } = createPreDuelOverlay("bf-first-player-panel");
      overlay.setAttribute("aria-label", "AI chooses who goes first");
      appendPreDuelHead(panel, "RPS Winner", "AI Chooses First");

      const message = document.createElement("div");
      message.className = "bf-preduel-message";
      message.textContent = "AI won the throw and chooses to go first.";

      panel.appendChild(message);
      window.setTimeout(() => {
        removePreDuelOverlay(overlay);
        resolve("ai");
      }, 1300);
    });
  }

  async function chooseStartingPlayerAfterRps(winner) {
    if (winner === "player") return promptPlayerFirstChoice();
    return promptAiFirstChoice();
  }

  // Card info pane
  const cardInfoEl      = $("[data-card-info]");
  const ciArtEl         = $("[data-ci-art]");
  const ciNameEl        = $("[data-ci-name]");
  const ciTypeEl        = $("[data-ci-type]");
  const ciStatsEl       = $("[data-ci-stats]");
  const ciLevelEl       = $("[data-ci-level]");
  const ciAtkEl         = $("[data-ci-atk]");
  const ciDefEl         = $("[data-ci-def]");
  const ciDescEl        = $("[data-ci-desc]");

  function phaseLabel(phase) {
    const labels = {
      draw: "Draw",
      main1: "Main 1",
      battle: "Battle",
      main2: "Main 2",
      end: "End"
    };
    return labels[phase] || String(phase || "");
  }

  function isDuelEnded() {
    return state.activePlayer === "none" || Boolean(state.defeatedOwner);
  }

  function updateSurrenderButton() {
    if (!surrenderBtn) return;
    surrenderBtn.disabled = !duelDeckCards.length || isDuelEnded();
  }

  function appendBattleLog(msg) {
    if (!battleLogListEl) return;
    const text = String(msg || "").trim();
    if (!text) return;

    if (battleLogEmptyEl) battleLogEmptyEl.hidden = true;

    const entry = document.createElement("div");
    entry.className = "bf-battle-log-entry is-new";

    const meta = document.createElement("span");
    meta.className = "bf-battle-log-meta";
    meta.textContent = `Turn ${state.turn} - ${phaseLabel(state.phase)}`;

    const body = document.createElement("span");
    body.className = "bf-battle-log-text";
    body.textContent = text;

    entry.append(meta, body);
    battleLogListEl.appendChild(entry);

    const entries = Array.from(battleLogListEl.querySelectorAll(".bf-battle-log-entry"));
    entries.slice(0, Math.max(0, entries.length - 80)).forEach((oldEntry) => oldEntry.remove());
    battleLogListEl.scrollTop = battleLogListEl.scrollHeight;

    setTimeout(() => entry.classList.remove("is-new"), 300);
  }

  function showStatus(msg, duration = 2800) {
    appendBattleLog(msg);
    if (statusEl) statusEl.hidden = true;
    if (statusMsgEl) statusMsgEl.textContent = "";
  }

  function resetBattleLog() {
    if (!battleLogListEl) return;
    battleLogListEl.innerHTML = "";
    if (battleLogEmptyEl) {
      battleLogEmptyEl.hidden = false;
      battleLogListEl.appendChild(battleLogEmptyEl);
    }
  }

  // ── Render helpers ────────────────────────────────────────
  const MAX_LP = 8000;
  const ATTACK_ARROW_MS = 1250;
  const CARD_TRAVEL_MS = 680;
  const CARD_SHATTER_MS = 640;
  const BATTLE_QUAKE_MS = 560;
  const TRAP_BLOCK_MS = 900;
  const TRAP_REVEAL_MS = 920;
  const BLOCK_ATTACK_GIF_SRC = "assets/gifs/block_attack.gif";
  const SPELL_EFFECT_SETTLE_MS = 260;
  const SPELL_LP_ANIM_MS = 980;
  const AI_FACE_DOWN_DEFENSE_GUESS = 1500;
  const AI_FACE_DOWN_VALUE_GUESS = 1200;
  const SFX_VOLUME = 0.42;
  const SFX = {
    cardDestroyed: "assets/sounds/card_destroyed.mp3",
    deckShuffle: "assets/sounds/deck_shuffle.mp3",
    drawCard: "assets/sounds/draw_card.mp3",
    gainLife: "assets/sounds/gain_life_points.mp3",
    higherDefenseAttack: "assets/sounds/higher_defense_attack.mp3",
    loseLife: "assets/sounds/lose_life_points.mp3",
    monsterAttack: "assets/sounds/monster_attack.mp3",
    monsterDirectAttack: "assets/sounds/monster_direct_attack.mp3",
    monsterEffectUsed: "assets/sounds/monster_effect_used.mp3",
    monsterSet: "assets/sounds/monster_set_on_field.mp3",
    monsterSummon: "assets/sounds/monster_summon.mp3",
    openGraveyard: "assets/sounds/open_graveyard_slot.mp3",
    spellTrapActivate: "assets/sounds/spell_trap_activate.mp3",
    spellTrapSet: "assets/sounds/spell_trap_set_on_field.mp3",
    endTurn: "assets/sounds/end_turn_sound.mp3",
    victoryMusic: "assets/sounds/victory_music.mp3",
    defeatMusic: "assets/sounds/defeat_music.mp3"
  };
  const sfxCache = new Map();
  let resultMusicAudio = null;

  function playSfx(name, volume = SFX_VOLUME) {
    const src = SFX[name];
    if (!src) return;
    try {
      let audio = sfxCache.get(name);
      if (!audio) {
        audio = new Audio(src);
        audio.preload = "auto";
        sfxCache.set(name, audio);
      }
      const instance = audio.cloneNode(true);
      instance.volume = Math.max(0, Math.min(1, volume));
      instance.play().catch(() => {});
      return instance;
    } catch {
      // Browsers can block audio until the first user gesture.
    }
    return null;
  }

  function updateLP() {
    if (playerLpEl) playerLpEl.textContent = state.playerLP;
    if (aiLpEl)     aiLpEl.textContent     = state.aiLP;
    if (playerLpFill) {
      const pct = Math.min(100, Math.max(0, (state.playerLP / MAX_LP) * 100));
      playerLpFill.style.height = pct + "%";
      playerLpFill.style.setProperty("--lp-percent", pct + "%");
      playerLpFill.classList.toggle("is-low", pct <= 25);
    }
    if (aiLpFill) {
      const pct = Math.min(100, Math.max(0, (state.aiLP / MAX_LP) * 100));
      aiLpFill.style.height = pct + "%";
      aiLpFill.style.setProperty("--lp-percent", pct + "%");
      aiLpFill.classList.toggle("is-low", pct <= 25);
    }
  }

  function updateCounts() {
    if (playerDeckCount) playerDeckCount.textContent = state.playerDeck.length;
    if (aiDeckCount)     aiDeckCount.textContent     = state.aiDeck.length;
    if (playerGYCount)   playerGYCount.textContent   = state.playerGY.length;
    if (aiGYCount)       aiGYCount.textContent       = state.aiGY.length;
    if (playerGYSlot)    playerGYSlot.classList.toggle("has-cards", state.playerGY.length > 0);
    if (aiGYSlot)        aiGYSlot.classList.toggle("has-cards",     state.aiGY.length > 0);
  }

  function ownerMonsterField(owner) {
    return owner === "player" ? state.playerMonster : state.aiMonster;
  }

  function ownerGraveyard(owner) {
    return owner === "player" ? state.playerGY : state.aiGY;
  }

  function ownerDeck(owner) {
    return owner === "player" ? state.playerDeck : state.aiDeck;
  }

  function ownerHand(owner) {
    return owner === "player" ? state.playerHand : state.aiHand;
  }

  function ownerGraveyardSlot(owner) {
    return owner === "player" ? playerGYSlot : aiGYSlot;
  }

  function ownerDeckPile(owner) {
    return owner === "player" ? playerDeckPile : aiDeckPile;
  }

  function ownerHandEl(owner) {
    return owner === "player" ? playerHandEl : aiHandEl;
  }

  function ownerSpellTrapField(owner) {
    return owner === "player" ? state.playerSpellTrap : state.aiSpellTrap;
  }

  function spellTrapSlots(owner) {
    return Array.from((owner === "player" ? playerSTZone : aiSTZone).querySelectorAll(".bf-slot"));
  }

  function fieldForZone(owner, zone) {
    return zone === "monster" ? ownerMonsterField(owner) : ownerSpellTrapField(owner);
  }

  function slotsForZone(owner, zone) {
    return zone === "monster" ? monsterSlots(owner) : spellTrapSlots(owner);
  }

  function spellParams(card) {
    return card?.spellEffectParams && typeof card.spellEffectParams === "object"
      ? card.spellEffectParams
      : {};
  }

  function trapEffectName(card) {
    return String(card?.trapEffect || "").trim();
  }

  function isNegatingTrapEffect(effect) {
    return [
      "negate-attack",
      "negate-attack-damage",
      "negate-summon",
      "negate-effect",
      "negate-effect-destroy"
    ].includes(effect);
  }

  function trapParams(card) {
    return card?.trapEffectParams && typeof card.trapEffectParams === "object"
      ? card.trapEffectParams
      : {};
  }

  function boundedNumber(value, fallback, min = 0, max = 99999) {
    const number = Number.parseInt(value, 10);
    if (Number.isNaN(number)) return fallback;
    return Math.max(min, Math.min(max, number));
  }

  function isMonsterCard(card) {
    return cardTypeName(card) === "monster";
  }

  function readRect(elOrRect) {
    if (!elOrRect) return null;
    if (typeof elOrRect.getBoundingClientRect === "function") {
      const rect = elOrRect.getBoundingClientRect();
      return {
        left: rect.left,
        top: rect.top,
        width: rect.width,
        height: rect.height
      };
    }
    if (typeof elOrRect.left === "number" && typeof elOrRect.top === "number") {
      return {
        left: elOrRect.left,
        top: elOrRect.top,
        width: Number(elOrRect.width) || 0,
        height: Number(elOrRect.height) || 0
      };
    }
    return null;
  }

  function createCardGhost(card, fromRect, className = "", faceDown = false) {
    const rect = readRect(fromRect);
    if (!rect) return null;

    const ghost = document.createElement("div");
    ghost.className = `bf-card-ghost ${className}`.trim();
    ghost.style.left = `${rect.left}px`;
    ghost.style.top = `${rect.top}px`;
    ghost.style.width = `${Math.max(1, rect.width)}px`;
    ghost.style.height = `${Math.max(1, rect.height)}px`;

    if (faceDown) {
      const back = document.createElement("div");
      back.className = "bf-card-ghost-back bf-card-back";
      ghost.appendChild(back);
    } else {
      const face = document.createElement("div");
      face.className = "bf-card-ghost-face";
      face.appendChild(makeArtEl(card, "bf-card-ghost-art"));
      ghost.appendChild(face);
    }

    document.body.appendChild(ghost);
    return ghost;
  }

  async function animateCardMove(card, fromElOrRect, toElOrRect, className = "", options = {}) {
    const fromRect = readRect(fromElOrRect);
    const toRect = readRect(toElOrRect);
    if (!card || !fromRect || !toRect) return;

    const duration = options.duration || CARD_TRAVEL_MS;
    const ghost = createCardGhost(card, fromRect, className, options.faceDown);
    if (!ghost) return;

    const fromX = fromRect.left + fromRect.width / 2;
    const fromY = fromRect.top + fromRect.height / 2;
    const toX = toRect.left + toRect.width / 2;
    const toY = toRect.top + toRect.height / 2;
    const scale = Math.min(1.08, Math.max(0.56, toRect.width / Math.max(1, fromRect.width)));

    ghost.style.transitionDuration = `${duration}ms`;
    requestAnimationFrame(() => {
      ghost.style.transform = `translate(${toX - fromX}px, ${toY - fromY}px) scale(${scale})`;
      ghost.style.opacity = "0";
    });

    await sleep(duration);
    ghost.remove();
  }

  function animateDrawCard(owner, card) {
    const handEl = ownerHandEl(owner);
    const target = handEl?.lastElementChild || handEl;
    if (handEl && target && isCompactInteractionMode()) {
      handEl.scrollLeft = Math.max(0, handEl.scrollWidth - handEl.clientWidth);
      target.getBoundingClientRect();
    }
    playSfx("drawCard");
    return animateCardMove(card, ownerDeckPile(owner), target, "is-draw", {
      faceDown: owner === "ai"
    });
  }

  function animatePlaceCard(card, fromElOrRect, toElOrRect, faceDown = false) {
    const slot = typeof toElOrRect?.classList !== "undefined" ? toElOrRect : null;
    if (slot) {
      slot.classList.add("is-placing");
      setTimeout(() => slot.classList.remove("is-placing"), CARD_TRAVEL_MS + 120);
    }
    return animateCardMove(card, fromElOrRect, toElOrRect, "is-place", { faceDown });
  }

  function animateCardToGraveyard(card, fromElOrRect, owner) {
    animateCardMove(card, fromElOrRect, ownerGraveyardSlot(owner), "is-to-graveyard");
  }

  async function animateCardShatter(card, slotEl, options = {}) {
    const rect = readRect(slotEl);
    if (!card || !rect) return;

    playSfx("cardDestroyed");
    slotEl?.classList.add("is-breaking");
    const faceDown = options.faceDown ?? Boolean(card._faceDown);
    const shards = [];
    const rows = 3;
    const cols = 3;
    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < cols; col++) {
        const shard = createCardGhost(card, rect, "bf-card-shard", faceDown);
        if (!shard) continue;
        const top = (row / rows) * 100;
        const right = ((cols - col - 1) / cols) * 100;
        const bottom = ((rows - row - 1) / rows) * 100;
        const left = (col / cols) * 100;
        const driftX = (col - 1) * 34 + (row % 2 ? 16 : -16);
        const driftY = (row - 1) * 34 - 20;
        const rotate = (row * 3 + col - 4) * 13;
        shard.style.clipPath = `inset(${top}% ${right}% ${bottom}% ${left}%)`;
        shard.style.setProperty("--shard-x", `${driftX}px`);
        shard.style.setProperty("--shard-y", `${driftY}px`);
        shard.style.setProperty("--shard-rot", `${rotate}deg`);
        shards.push(shard);
      }
    }

    if (slotEl && options.clearSlot !== false) renderSlot(slotEl, null, false);

    requestAnimationFrame(() => {
      shards.forEach((shard) => shard.classList.add("is-flying"));
    });

    await sleep(CARD_SHATTER_MS);
    slotEl?.classList.remove("is-breaking");
    shards.forEach((shard) => shard.remove());
  }

  async function sendMonsterToGraveyard(owner, slotIdx, options = {}) {
    const field = ownerMonsterField(owner);
    const card = field[slotIdx];
    if (!card) return;

    const slot = monsterSlots(owner)[slotIdx];
    const fromRect = readRect(slot);
    const faceDown = options.faceDown ?? Boolean(card._faceDown);
    if (options.shatter) {
      field[slotIdx] = null;
      await animateCardShatter(card, slot, { faceDown });
      ownerGraveyard(owner).push(card);
      renderField();
      updateCounts();
      if (options.destroyerOwner && !options.suppressEffectMonsterDestroy) {
        await triggerEffectMonsterResponses({
          type: "destroyed",
          destroyedOwner: owner,
          destroyedZone: "monster",
          destroyedCard: card,
          destroyerOwner: options.destroyerOwner,
          sourceCard: options.sourceCard || null
        }, { owner });
        await notifyCardsDestroyedBy(options.destroyerOwner, [{ owner, zone: "monster", card }], options.sourceCard || null);
      }
      return;
    }

    ownerGraveyard(owner).push(card);
    field[slotIdx] = null;
    renderField();
    updateCounts();
    await animateCardMove(card, fromRect, ownerGraveyardSlot(owner), "is-to-graveyard", { faceDown });
    if (options.destroyerOwner && !options.suppressEffectMonsterDestroy) {
      await triggerEffectMonsterResponses({
        type: "destroyed",
        destroyedOwner: owner,
        destroyedZone: "monster",
        destroyedCard: card,
        destroyerOwner: options.destroyerOwner,
        sourceCard: options.sourceCard || null
      }, { owner });
      await notifyCardsDestroyedBy(options.destroyerOwner, [{ owner, zone: "monster", card }], options.sourceCard || null);
    }
  }

  async function sendFieldCardToGraveyard(owner, zone, slotIdx, options = {}) {
    const field = fieldForZone(owner, zone);
    const card = field[slotIdx];
    if (!card) return;

    const slot = slotsForZone(owner, zone)[slotIdx];
    const fromRect = readRect(slot);
    const faceDown = options.faceDown ?? Boolean(card._faceDown);
    if (options.shatter) {
      field[slotIdx] = null;
      await animateCardShatter(card, slot, { faceDown });
      ownerGraveyard(owner).push(card);
      renderField();
      updateCounts();
      if (options.destroyerOwner && !options.suppressEffectMonsterDestroy) {
        await triggerEffectMonsterResponses({
          type: "destroyed",
          destroyedOwner: owner,
          destroyedZone: zone,
          destroyedCard: card,
          destroyerOwner: options.destroyerOwner,
          sourceCard: options.sourceCard || null
        }, { owner });
        await notifyCardsDestroyedBy(options.destroyerOwner, [{ owner, zone, card }], options.sourceCard || null);
      }
      return;
    }

    ownerGraveyard(owner).push(card);
    field[slotIdx] = null;
    renderField();
    updateCounts();
    await animateCardMove(card, fromRect, ownerGraveyardSlot(owner), "is-to-graveyard", {
      faceDown
    });
    if (options.destroyerOwner && !options.suppressEffectMonsterDestroy) {
      await triggerEffectMonsterResponses({
        type: "destroyed",
        destroyedOwner: owner,
        destroyedZone: zone,
        destroyedCard: card,
        destroyerOwner: options.destroyerOwner,
        sourceCard: options.sourceCard || null
      }, { owner });
      await notifyCardsDestroyedBy(options.destroyerOwner, [{ owner, zone, card }], options.sourceCard || null);
    }
  }

  function destroyFieldCardToGraveyard(owner, zone, slotIdx, options = {}) {
    return sendFieldCardToGraveyard(owner, zone, slotIdx, {
      ...options,
      shatter: true
    });
  }

  async function sendHandCardsToGraveyard(owner, handIndexes) {
    const hand = owner === "player" ? state.playerHand : state.aiHand;
    const handEl = ownerHandEl(owner);
    const targets = [...handIndexes]
      .filter((idx) => hand[idx])
      .sort((a, b) => b - a)
      .map((idx) => ({
        idx,
        card: hand[idx],
        rect: readRect(handEl?.children[idx])
      }));

    targets.forEach(({ idx, card }) => {
      hand.splice(idx, 1);
      ownerGraveyard(owner).push(card);
    });

    renderPlayerHand();
    renderAiHand();
    updateCounts();
    await Promise.all(targets.map(({ card, rect }) => (
      animateCardMove(card, rect, ownerGraveyardSlot(owner), "is-to-graveyard", {
        faceDown: owner === "ai"
      })
    )));
  }

  async function sendActivatedSpellToGraveyard(spellContext) {
    if (!spellContext?.card) return;
    let fromRect = spellContext.sourceRect;

    if (spellContext.source === "field" && Number.isInteger(spellContext.slotIdx)) {
      const fieldCard = state.playerSpellTrap[spellContext.slotIdx];
      const slot = spellTrapSlots("player")[spellContext.slotIdx];
      fromRect = readRect(slot) || fromRect;
      if (fieldCard) state.playerSpellTrap[spellContext.slotIdx] = null;
      renderField();
    }

    state.playerGY.push(spellContext.card);
    updateCounts();
    await animateCardMove(spellContext.card, fromRect, playerGYSlot, "is-to-graveyard");
  }

  function animateLifeChange(owner, delta) {
    const bar = lifeBar(owner);
    const rect = readRect(bar);
    if (!rect || delta === 0) return;

    const floatEl = document.createElement("div");
    floatEl.className = `bf-lp-float ${delta > 0 ? "is-gain" : "is-loss"}`;
    floatEl.textContent = `${delta > 0 ? "+" : "-"}${Math.abs(delta)}`;
    floatEl.style.left = `${rect.left + rect.width / 2}px`;
    floatEl.style.top = `${rect.top + rect.height / 2}px`;
    document.body.appendChild(floatEl);
    setTimeout(() => floatEl.remove(), 1050);
  }

  function renderSlot(slotEl, card, faceDown, allowPreview = true) {
    slotEl.innerHTML = "";
    slotEl.classList.remove("is-defense");
    if (!card) {
      slotEl.classList.remove("is-filled");
      return;
    }
    slotEl.classList.add("is-filled");
    const actualFaceDown = faceDown || card._faceDown;
    if (card._position === "defense") slotEl.classList.add("is-defense");
    if (actualFaceDown) {
      const back = document.createElement("div");
      back.className = "bf-slot-face bf-card-back";
      if (allowPreview) bindCardHoldPreview(back, card);
      slotEl.appendChild(back);
      return;
    }
    const isMonster = cardTypeName(card) === "monster";
    const face = document.createElement("div");
    face.className = "bf-slot-face";
    if (card._justFlipped) {
      face.classList.add("bf-flip-reveal");
      delete card._justFlipped;
    }
    if (card._justModeChanged) {
      face.classList.add("bf-mode-change");
      delete card._justModeChanged;
    }

    const artEl = makeArtEl(card, "bf-slot-face-art");
    face.appendChild(artEl);

    const nameEl = document.createElement("div");
    nameEl.className = "bf-slot-face-name";
    nameEl.textContent = cardNameStr(card);
    face.appendChild(nameEl);

    if (isMonster) {
      const stats = document.createElement("div");
      stats.className = "bf-slot-stats";
      stats.innerHTML = `<span>${cardAtk(card)}</span><span>${cardDef(card)}</span>`;
      face.appendChild(stats);
    }

    slotEl.appendChild(face);
    if (allowPreview) bindCardHoldPreview(face, card);
  }

  function modeChangeKey(owner, slotIdx) {
    return `${owner}:${slotIdx}`;
  }

  function clearModeChangesFor(owner) {
    state.monstersChangedModeThisTurn = new Set(
      Array.from(state.monstersChangedModeThisTurn).filter((key) => !key.startsWith(`${owner}:`))
    );
  }

  function canChangeMonsterMode(owner, slotIdx) {
    const card = ownerMonsterField(owner)[slotIdx];
    if (!card || card._faceDown || cardTypeName(card) !== "monster") return false;
    if (state.activePlayer !== owner) return false;
    if (state.phase !== "main1" && state.phase !== "main2") return false;
    if (state.battleEnteredThisTurn) return false;
    if (state.resolvingBattle) return false;
    return !state.monstersChangedModeThisTurn.has(modeChangeKey(owner, slotIdx));
  }

  function changeMonsterMode(owner, slotIdx, nextPosition = null, options = {}) {
    if (!canChangeMonsterMode(owner, slotIdx)) return false;
    const card = ownerMonsterField(owner)[slotIdx];
    const position = nextPosition || (card._position === "defense" ? "attack" : "defense");
    if (position !== "attack" && position !== "defense") return false;
    if (card._position === position) return false;

    card._position = position;
    card._justModeChanged = true;
    state.monstersChangedModeThisTurn.add(modeChangeKey(owner, slotIdx));

    if (options.render !== false) renderField();
    if (!options.silent) {
      const label = position === "attack" ? "Attack" : "Defense";
      showStatus(`${cardNameStr(card)} changed to ${label} Position.`, 1500);
    }
    return true;
  }

  function attackCountKey(owner, slotIdx) {
    return `${owner}:${slotIdx}`;
  }

  function monsterAttackLimit(owner, slotIdx) {
    const card = ownerMonsterField(owner)[slotIdx];
    if (!card) return 1;
    return Number(card._doubleAttackUntilTurn || 0) >= state.turn ? 2 : 1;
  }

  function monsterAttackCount(owner, slotIdx) {
    return Number(state.monsterAttackCountsThisTurn.get(attackCountKey(owner, slotIdx)) || 0);
  }

  function hasMonsterFinishedAttacking(owner, slotIdx) {
    return monsterAttackCount(owner, slotIdx) >= monsterAttackLimit(owner, slotIdx);
  }

  function markMonsterAttacked(owner, slotIdx) {
    const key = attackCountKey(owner, slotIdx);
    const nextCount = monsterAttackCount(owner, slotIdx) + 1;
    state.monsterAttackCountsThisTurn.set(key, nextCount);
    if (owner === "player" && nextCount >= monsterAttackLimit(owner, slotIdx)) {
      state.monstersAttackedThisTurn.add(slotIdx);
    }
  }

  function addTemporaryStatEffect(card, stat, amount, untilTurn, options = {}) {
    if (!card || !amount) return;
    if (stat === "defense") card.defensePoints = Math.max(0, cardDef(card) + amount);
    else card.attackPoints = Math.max(0, cardAtk(card) + amount);
    card._temporaryStatEffects = Array.isArray(card._temporaryStatEffects) ? card._temporaryStatEffects : [];
    card._temporaryStatEffects.push({
      stat: stat === "defense" ? "defense" : "attack",
      amount,
      untilTurn,
      battleOnly: Boolean(options.battleOnly)
    });
    card._justModeChanged = true;
  }

  function expireTemporaryMonsterEffects(options = {}) {
    const battleOnly = Boolean(options.battleOnly);
    ["player", "ai"].forEach((owner) => {
      ownerMonsterField(owner).forEach((card) => {
        if (!card) return;
        if (Number(card._doubleAttackUntilTurn || 0) < state.turn) delete card._doubleAttackUntilTurn;
        ["_effectTargetImmuneUntilTurn", "_attackTargetImmuneUntilTurn"].forEach((key) => {
          if (Number(card[key] || 0) < state.turn) delete card[key];
        });
        const effects = Array.isArray(card._temporaryStatEffects) ? card._temporaryStatEffects : [];
        const remaining = [];
        effects.forEach((effect) => {
          const expired = battleOnly ? effect.battleOnly : Number(effect.untilTurn || 0) < state.turn;
          if (expired) {
            const amount = Number(effect.amount || 0);
            if (effect.stat === "defense") card.defensePoints = Math.max(0, cardDef(card) - amount);
            else card.attackPoints = Math.max(0, cardAtk(card) - amount);
          } else {
            remaining.push(effect);
          }
        });
        if (remaining.length) card._temporaryStatEffects = remaining;
        else delete card._temporaryStatEffects;
      });
    });
  }

  function isProtectedFromEffectTarget(owner, zone, index, sourceOwner) {
    if (zone !== "monster" || owner === sourceOwner) return false;
    const card = ownerMonsterField(owner)[index];
    return Boolean(card && Number(card._effectTargetImmuneUntilTurn || 0) >= state.turn);
  }

  function isProtectedFromAttackTarget(owner, index, attackerOwner) {
    if (owner === attackerOwner) return false;
    const card = ownerMonsterField(owner)[index];
    return Boolean(card && Number(card._attackTargetImmuneUntilTurn || 0) >= state.turn);
  }

  let attackIconPointer = null;

  function updateAttackIconAim(event = null) {
    if (event && Number.isFinite(event.clientX) && Number.isFinite(event.clientY)) {
      attackIconPointer = { x: event.clientX, y: event.clientY };
    }

    document.querySelectorAll(".bf-attack-icon").forEach((icon) => {
      if (Number(icon.dataset.slotIdx) !== state.selectedAttackIdx || !attackIconPointer) {
        icon.style.setProperty("--attack-icon-x", "0px");
        icon.style.setProperty("--attack-icon-y", "0px");
        icon.style.setProperty("--attack-icon-rot", "0deg");
        return;
      }

      const slot = icon.closest(".bf-slot");
      const rect = slot?.getBoundingClientRect();
      if (!rect) return;

      const centerX = rect.left + rect.width / 2;
      const centerY = rect.top + rect.height / 2;
      const dx = attackIconPointer.x - centerX;
      const dy = attackIconPointer.y - centerY;
      const radians = Math.atan2(dy, dx);
      const distance = Math.min(1, Math.hypot(dx, dy) / Math.max(1, Math.max(rect.width, rect.height)));
      const follow = Math.min(rect.width, rect.height) * 0.14 * distance;

      icon.style.setProperty("--attack-icon-x", `${Math.cos(radians) * follow}px`);
      icon.style.setProperty("--attack-icon-y", `${Math.sin(radians) * follow}px`);
      icon.style.setProperty("--attack-icon-rot", `${(radians * 180 / Math.PI) + 90}deg`);
    });
  }

  function addAttackIcon(slotEl, slotIdx) {
    if (!canPlayerMonsterAttack(slotIdx)) return;
    const icon = document.createElement("div");
    icon.className = "bf-attack-icon";
    icon.dataset.slotIdx = String(slotIdx);
    icon.setAttribute("aria-hidden", "true");
    slotEl.appendChild(icon);
  }

  function canPlayerMonsterAttack(slotIdx) {
    const card = state.playerMonster[slotIdx];
    return Boolean(
      card &&
      state.activePlayer === "player" &&
      state.phase === "battle" &&
      !card._faceDown &&
      card._position !== "defense" &&
      !hasMonsterFinishedAttacking("player", slotIdx)
    );
  }

  function renderField() {
    const pmSlots = Array.from(playerMonZone.querySelectorAll(".bf-slot"));
    pmSlots.forEach((el, i) => {
      el.onmouseenter = null;
      el.onmouseleave = null;
      renderSlot(el, state.playerMonster[i], false, true);
      el.classList.toggle("is-attack-ready", canPlayerMonsterAttack(i));
      addAttackIcon(el, i);
      if (state.playerMonster[i]) {
        el.onmouseenter = () => {
          if (state.playerMonster[i]) showCardInfo(state.playerMonster[i]);
        };
        el.onmouseleave = clearCardInfo;
      }
    });

    const psSlots = Array.from(playerSTZone.querySelectorAll(".bf-slot"));
    psSlots.forEach((el, i) => {
      el.onmouseenter = null;
      el.onmouseleave = null;
      renderSlot(el, state.playerSpellTrap[i], false, true);
      if (state.playerSpellTrap[i]) {
        el.onmouseenter = () => {
          if (state.playerSpellTrap[i]) showCardInfo(state.playerSpellTrap[i]);
        };
        el.onmouseleave = clearCardInfo;
      }
    });

    const amSlots = Array.from(aiMonZone.querySelectorAll(".bf-slot"));
    amSlots.forEach((el, i) => {
      el.onmouseenter = null;
      el.onmouseleave = null;
      renderSlot(el, state.aiMonster[i], false, !Boolean(state.aiMonster[i]?._faceDown));
      if (state.aiMonster[i]) {
        el.onmouseenter = () => {
          if (state.aiMonster[i]) showCardInfo(state.aiMonster[i]);
        };
        el.onmouseleave = clearCardInfo;
      }
    });

    const asSlots = Array.from(aiSTZone.querySelectorAll(".bf-slot"));
    asSlots.forEach((el, i) => renderSlot(el, state.aiSpellTrap[i], !!state.aiSpellTrap[i], false));
    updateAttackIconAim();
  }

  function renderPlayerHand() {
    if (!playerHandEl) return;
    playerHandEl.innerHTML = "";
    state.playerHand.forEach((card, i) => {
      const el = document.createElement("div");
      el.className = "bf-hand-card";
      if (state.selectedHandIdx === i) el.classList.add("is-selected");
      if (state.pendingSpell?.kind === "special-summon-hand" &&
          state.pendingSpell.eligibleHandIndexes.includes(i)) {
        el.classList.add("is-spell-target");
      }

      const t = cardTypeName(card);
      const isMonster = t === "monster";
      const typeLine  = t.charAt(0).toUpperCase() + t.slice(1);

      const artEl = makeArtEl(card, "bf-hand-card-art");
      el.appendChild(artEl);

      const details = document.createElement("div");
      details.className = "bf-hand-card-details";
      details.innerHTML = `
        <div class="bf-hand-card-name">${cardNameStr(card)}</div>
        <div class="bf-hand-card-type is-${t}">${typeLine}</div>
        ${isMonster ? `<div class="bf-hand-card-stats"><span>ATK ${cardAtk(card)}</span><span>DEF ${cardDef(card)}</span></div>` : ""}
      `;
      el.appendChild(details);
      bindCardHoldPreview(el, card);

      el.addEventListener("mouseenter", () => showCardInfo(card));
      el.addEventListener("mouseleave", () => { if (state.selectedHandIdx !== i) clearCardInfo(); });
      el.addEventListener("click", () => {
        if (cardClickWasHeld()) return;
        if (handleSpellHandSelection(i, el)) return;
        if (isCompactInteractionMode()) {
          openHandCardMenu(i, el);
          return;
        }
        selectHandCard(i);
      });
      el.addEventListener("contextmenu", (event) => {
        event.preventDefault();
        if (isCompactInteractionMode() || cardClickWasHeld()) return;
        openHandCardMenu(i, el);
      });
      playerHandEl.appendChild(el);
    });
  }

  function renderAiHand() {
    if (!aiHandEl) return;
    aiHandEl.innerHTML = "";
    state.aiHand.forEach(() => {
      const el = document.createElement("div");
      el.className = "bf-ai-hand-card bf-card-back";
      aiHandEl.appendChild(el);
    });
  }

  function renderPhases() {
    phaseButtons.forEach((btn) => {
      const active = btn.dataset.bfPhase === state.phase;
      btn.classList.toggle("is-active", active);
      btn.setAttribute("aria-current", active ? "step" : "false");
    });
    if (turnEl) turnEl.textContent = state.turn;
    updateSurrenderButton();
  }

  function setPhase(phase) {
    const previousPhase = state.phase;
    if (previousPhase === "battle" && phase !== "battle") {
      expireTemporaryMonsterEffects({ battleOnly: true });
    }
    state.phase = phase;
    if (phase === "battle") state.battleEnteredThisTurn = true;
    if (phase !== "battle") clearBattleSelection();
    renderPhases();
    renderField();
    updateDrawPrompt();
    if (endTurnBtn) {
      const canEnd = state.activePlayer === "player" && phase !== "draw";
      endTurnBtn.disabled = !canEnd;
    }
  }

  // Show / hide the "▼ DRAW" prompt beside the player deck
  function updateDrawPrompt() {
    if (!drawPromptEl) return;
    const show = state.activePlayer === "player"
              && state.phase === "draw"
              && !state.hasDrawn;
    drawPromptEl.hidden = !show;
  }

  // ── Draw ────────────────────────────────────────────────
  async function drawCard(player) {
    let drawnCard = null;
    if (player === "player") {
      if (!state.playerDeck.length) { endGame("AI wins — you ran out of cards!"); return false; }
      drawnCard = state.playerDeck.shift();
      state.playerHand.push(drawnCard);
      renderPlayerHand();
      await animateDrawCard("player", drawnCard);
    } else {
      if (!state.aiDeck.length) { endGame("You win — AI ran out of cards!"); return false; }
      drawnCard = state.aiDeck.shift();
      state.aiHand.push(drawnCard);
      renderAiHand();
      await animateDrawCard("ai", drawnCard);
    }
    updateCounts();
    await triggerEffectMonsterResponses({ type: "draw", owner: player, card: drawnCard }, { owner: player });
    return true;
  }

  // ── Select a hand card ──────────────────────────────────
  async function drawCardVisible(player) {
    if (player === "player") {
      if (!state.playerDeck.length) { endGame("AI wins - you ran out of cards!"); return false; }
      const card = state.playerDeck.shift();
      state.playerHand.push(card);
      renderPlayerHand();
      updateCounts();
      await animateDrawCard("player", card);
      await triggerEffectMonsterResponses({ type: "draw", owner: "player", card }, { owner: "player" });
      return true;
    }

    if (!state.aiDeck.length) { endGame("You win - AI ran out of cards!"); return false; }
    const card = state.aiDeck.shift();
    state.aiHand.push(card);
    renderAiHand();
    updateCounts();
    await animateDrawCard("ai", card);
    await triggerEffectMonsterResponses({ type: "draw", owner: "ai", card }, { owner: "ai" });
    return true;
  }

  function selectHandCard(idx) {
    if (isSpellResolutionBusy()) {
      showStatus("Finish resolving the active spell first.");
      return;
    }
    const wasSelected = state.selectedHandIdx === idx;
    state.selectedHandIdx = wasSelected ? null : idx;
    state.pendingAction = null;
    state.tributesPending = 0;
    state.tributesSelected = [];
    clearSlotHighlights();
    renderPlayerHand();
    if (state.selectedHandIdx !== null) {
      showCardInfo(state.playerHand[idx]);
    } else {
      clearCardInfo();
    }
  }

  // ── Play a card from hand to field ─────────────────────
  let _handMenuEl = null;
  let _choiceDialogEl = null;
  let _deckDialogEl = null;
  let _trapPromptEl = null;
  let _spellResolveBtnEl = null;
  let _holdPreviewEl = null;
  let suppressCardClickUntil = 0;

  function isPlayerMainPhase() {
    return state.activePlayer === "player" && (state.phase === "main1" || state.phase === "main2");
  }

  function isSpellResolutionBusy() {
    return Boolean(state.resolvingSpell || state.pendingSpell || state.pendingFieldSelection || state.resolvingTrap || state.resolvingEffectMonster);
  }

  function closeChoiceDialog() {
    if (_choiceDialogEl) {
      _choiceDialogEl.remove();
      _choiceDialogEl = null;
    }
  }

  function closeDeckDialog() {
    if (_deckDialogEl) {
      _deckDialogEl.remove();
      _deckDialogEl = null;
    }
  }

  function closeSpellResolveButton() {
    if (_spellResolveBtnEl) {
      _spellResolveBtnEl.remove();
      _spellResolveBtnEl = null;
    }
  }

  function showSpellResolveButton(label, onClick) {
    closeSpellResolveButton();
    const btn = document.createElement("button");
    btn.className = "bf-spell-resolve-btn";
    btn.type = "button";
    btn.textContent = label;
    btn.addEventListener("click", async () => {
      closeSpellResolveButton();
      await onClick();
    });
    document.body.appendChild(btn);
    _spellResolveBtnEl = btn;
  }

  function openCardChoiceDialog(title, entries, onChoose, onCancel = null) {
    closeChoiceDialog();
    if (!entries.length) return false;

    const dialog = document.createElement("div");
    dialog.className = "bf-choice-dialog";
    _choiceDialogEl = dialog;

    const panel = document.createElement("div");
    panel.className = "bf-choice-panel";

    const head = document.createElement("div");
    head.className = "bf-choice-head";

    const heading = document.createElement("div");
    heading.className = "bf-choice-title";
    heading.textContent = title;
    head.appendChild(heading);

    const closeBtn = document.createElement("button");
    closeBtn.className = "bf-choice-close";
    closeBtn.type = "button";
    closeBtn.textContent = "X";
    closeBtn.addEventListener("click", () => {
      closeChoiceDialog();
      if (typeof onCancel === "function") onCancel();
    });
    head.appendChild(closeBtn);

    const list = document.createElement("div");
    list.className = "bf-choice-list";

    entries.forEach((entry) => {
      const btn = document.createElement("button");
      btn.className = "bf-choice-card";
      btn.type = "button";
      btn.innerHTML = `
        <span class="bf-choice-card-name">${cardNameStr(entry.card)}</span>
        <span class="bf-choice-card-meta">${cardTypeLabel(entry.card)}</span>
      `;
      btn.addEventListener("mouseenter", () => showCardInfo(entry.card));
      btn.addEventListener("mouseleave", clearCardInfo);
      btn.addEventListener("click", () => {
        closeChoiceDialog();
        onChoose(entry);
      });
      list.appendChild(btn);
    });

    panel.append(head, list);
    dialog.appendChild(panel);
    document.body.appendChild(dialog);
    return true;
  }

  function normalizeEffectText(value) {
    return String(value || "").replace(/[’]/g, "'").replace(/\s+/g, " ").trim().toLowerCase();
  }

  function isEffectMonsterCard(card) {
    return cardTypeName(card) === "monster" && String(card?.monsterType || "").toLowerCase() === "effect";
  }

  function effectMonsterCause(card) {
    return normalizeEffectText(card?.effectCause);
  }

  function effectMonsterOutcome(card) {
    return normalizeEffectText(cardEffectOutcome(card));
  }

  const EFFECT_MONSTER_COMBINED_ATTACK_BOOST =
    "select another monster you control and increase this monster's attack by 50% of the combined attack points for 2 turns.";
  const EFFECT_MONSTER_DESTROY_OPPONENT_MONSTER =
    "destroy an opponent's monster in the field.";

  function effectMonsterParams(card) {
    return effectParamsFromCard(card);
  }

  function effectUsageKey(entry) {
    return `${entry.owner}:${duelCardId(entry.card)}`;
  }

  function canUseEffectMonster(entry) {
    if (!entry?.card || !isEffectMonsterCard(entry.card)) return false;
    const key = effectUsageKey(entry);
    if (entry.card.effectOncePerTurn) return !state.effectMonsterUsesThisTurn.has(key);
    return !state.effectMonsterUsesEver.has(key);
  }

  function markEffectMonsterUsed(entry) {
    const key = effectUsageKey(entry);
    if (entry.card.effectOncePerTurn) state.effectMonsterUsesThisTurn.add(key);
    else state.effectMonsterUsesEver.add(key);
  }

  function currentEffectEntry(entry) {
    if (!entry?.card) return null;
    const uid = duelCardId(entry.card);
    const owner = entry.owner;

    if (entry.location === "field") {
      const field = ownerMonsterField(owner);
      let index = field.findIndex((card) => card && duelCardId(card) === uid);
      if (index < 0 && field[entry.index] && duelCardId(field[entry.index]) === uid) index = entry.index;
      if (index < 0) return null;
      const card = field[index];
      if (!card || card._faceDown) return null;
      return { ...entry, card, index, zone: "monster", location: "field" };
    }

    if (entry.location === "hand") {
      const hand = ownerHand(owner);
      let index = hand.findIndex((card) => card && duelCardId(card) === uid);
      if (index < 0) return null;
      return { ...entry, card: hand[index], index, zone: "hand", location: "hand" };
    }

    if (entry.location === "graveyard") {
      const graveyard = ownerGraveyard(owner);
      let index = graveyard.findIndex((card) => card && duelCardId(card) === uid);
      if (index < 0) return null;
      return { ...entry, card: graveyard[index], index, zone: "graveyard", location: "graveyard" };
    }

    return null;
  }

  function effectMonsterEntryLocationLabel(entry) {
    if (entry.location === "hand") return "Hand";
    if (entry.location === "graveyard") return "Graveyard";
    return `Monster Zone ${Number(entry.index || 0) + 1}`;
  }

  function effectMonsterEntriesForOwner(owner) {
    const entries = [];
    ownerMonsterField(owner).forEach((card, index) => {
      if (card && !card._faceDown && isEffectMonsterCard(card)) {
        entries.push({ owner, card, zone: "monster", index, location: "field" });
      }
    });
    ownerHand(owner).forEach((card, index) => {
      if (card && isEffectMonsterCard(card)) {
        entries.push({ owner, card, zone: "hand", index, location: "hand" });
      }
    });
    ownerGraveyard(owner).forEach((card, index) => {
      if (card && isEffectMonsterCard(card)) {
        entries.push({ owner, card, zone: "graveyard", index, location: "graveyard" });
      }
    });
    return entries;
  }

  function effectMonsterRespondsToEvent(entry, event) {
    if (!canUseEffectMonster(entry)) return false;
    const outcome = effectMonsterOutcome(entry.card);
    const owner = entry.owner;
    if (
      outcome === EFFECT_MONSTER_COMBINED_ATTACK_BOOST &&
      (entry.location !== "field" || !ownerMonsterField(owner).some((card) => card && !sameDuelCard(card, entry.card)))
    ) {
      return false;
    }
    const summonOnlyOutcomes = new Set([
      "this monster can attack twice during this turn's battle phase.",
      "this monster cannot be targeted by card effects for 2 turns after summon (including the turn it was summoned).",
      "this monster cannot be targeted by an attack for 2 turns after summon (including the turn it was summoned)."
    ]);
    if (summonOnlyOutcomes.has(outcome) && event.type !== "summon") return false;
    const cause = effectMonsterCause(entry.card);
    const opponent = opponentOwner(owner);
    const exactSource = (card) => sameDuelCard(entry.card, card);
    const fieldSource = entry.location === "field";
    const handSource = entry.location === "hand";
    const graveSource = entry.location === "graveyard";

    switch (cause) {
      case "if you gain life points":
        return fieldSource && event.type === "life-gain" && event.owner === owner;
      case "if this monster is flip summoned":
        return fieldSource && event.type === "summon" && event.summonKind === "flip" && exactSource(event.summonedCard);
      case "if you normal/special summoned a monster":
      case "if you normal/special summoned a monster, excluding this monster card":
        return fieldSource && event.type === "summon" && event.summonerOwner === owner && ["normal", "special"].includes(event.summonKind) && !exactSource(event.summonedCard);
      case "if this monster is normal/special summoned":
        return fieldSource && event.type === "summon" && event.summonerOwner === owner && ["normal", "special"].includes(event.summonKind) && exactSource(event.summonedCard);
      case "if a monster you control attacked":
        return fieldSource && event.type === "attack" && event.attackerOwner === owner;
      case "if this monster attacked":
        return fieldSource && event.type === "attack" && event.attackerOwner === owner && exactSource(event.attackerCard);
      case "if this monster is destroyed and sent to the graveyard":
        return graveSource && event.type === "destroyed" && event.destroyedOwner === owner && exactSource(event.destroyedCard);
      case "if this monster is drawn":
        return handSource && event.type === "draw" && event.owner === owner && exactSource(event.card);
      case "if this monster is in the hand":
        return handSource && event.type === "hand" && event.owner === owner;
      case "if this monster is attacked by the opponent":
        return fieldSource && event.type === "attack" && event.attackerOwner === opponent && event.defenderOwner === owner && exactSource(event.defenderCard);
      case "if opponent normal/special summons a monster":
        return fieldSource && event.type === "summon" && event.summonerOwner === opponent && ["normal", "special"].includes(event.summonKind);
      case "if opponent activates a card effect (spell/trap/effect monster)":
        return fieldSource && event.type === "effect-activated" && event.effectOwner === opponent;
      case "if opponent activates a spell/trap card":
        return fieldSource && event.type === "spelltrap-activated" && event.effectOwner === opponent;
      case "if opponent gains life points":
        return fieldSource && event.type === "life-gain" && event.owner === opponent;
      case "if opponent targets this monster by a card effect":
        return fieldSource && event.type === "effect-target" && event.sourceOwner === opponent && event.targetOwner === owner && exactSource(event.targetCard);
      case "if opponent destroys 1 or more monsters you control":
        return fieldSource && event.type === "cards-destroyed" && event.destroyerOwner === opponent && event.owner === owner
          && event.cards?.some((destroyed) => destroyed.zone === "monster");
      case "if opponent destroys 1 or more cards you control":
        return fieldSource && event.type === "cards-destroyed" && event.destroyerOwner === opponent && event.owner === owner
          && event.cards?.length > 0;
      default:
        return false;
    }
  }

  function eligibleEffectMonsterEntries(owner, event, usedKeys = new Set()) {
    return effectMonsterEntriesForOwner(owner)
      .map(currentEffectEntry)
      .filter(Boolean)
      .filter((entry) => !usedKeys.has(effectUsageKey(entry)))
      .filter((entry) => effectMonsterRespondsToEvent(entry, event));
  }

  function effectMonsterEventLabel(event) {
    if (event.type === "life-gain") return `${controllerName(event.owner)} gained life points.`;
    if (event.type === "draw") return `${controllerName(event.owner)} drew ${cardNameStr(event.card)}.`;
    if (event.type === "hand") return "An effect monster is in your hand.";
    if (event.type === "summon") return `${controllerName(event.summonerOwner)} summoned ${cardNameStr(event.summonedCard)}.`;
    if (event.type === "attack") {
      if (event.targetIdx === null) return `${cardNameStr(event.attackerCard)} is attacking directly.`;
      return `${cardNameStr(event.attackerCard)} is attacking ${cardNameStr(event.defenderCard)}.`;
    }
    if (event.type === "effect-activated" || event.type === "spelltrap-activated") {
      return `${controllerName(event.effectOwner)} activated ${cardNameStr(event.sourceCard)}.`;
    }
    if (event.type === "effect-target") return `${cardNameStr(event.targetCard)} was targeted by an effect.`;
    if (event.type === "destroyed") return `${cardNameStr(event.destroyedCard)} was sent to the graveyard.`;
    if (event.type === "cards-destroyed") return `${controllerName(event.destroyerOwner)} destroyed your card${event.cards?.length === 1 ? "" : "s"}.`;
    return "An effect monster can respond.";
  }

  function promptEffectMonsterActivation(entries, event) {
    closeTrapPrompt();

    return new Promise((resolve) => {
      const dialog = document.createElement("div");
      dialog.className = "bf-trap-prompt bf-effect-prompt";
      dialog.setAttribute("role", "dialog");
      dialog.setAttribute("aria-modal", "true");
      dialog.setAttribute("aria-label", "Activate effect monster?");

      const panel = document.createElement("div");
      panel.className = "bf-trap-prompt-panel bf-effect-prompt-panel";

      const title = document.createElement("div");
      title.className = "bf-trap-prompt-title";
      title.textContent = "Activate Effect Monster?";

      const message = document.createElement("div");
      message.className = "bf-trap-prompt-message";
      message.textContent = effectMonsterEventLabel(event);

      const list = document.createElement("div");
      list.className = "bf-effect-prompt-list";

      entries.forEach((entry) => {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "bf-effect-choice-card";
        btn.appendChild(createTrapPromptCard(entry.card));

        const meta = document.createElement("div");
        meta.className = "bf-effect-choice-meta";
        meta.textContent = `${effectMonsterEntryLocationLabel(entry)} - ${entry.card.effectOncePerTurn ? "Once per turn" : "Once per duel"}`;
        btn.appendChild(meta);

        btn.addEventListener("mouseenter", () => showCardInfo(entry.card));
        btn.addEventListener("mouseleave", clearCardInfo);
        btn.addEventListener("click", () => cleanup(entry));
        list.appendChild(btn);
      });

      const actions = document.createElement("div");
      actions.className = "bf-trap-prompt-actions";

      const skipBtn = document.createElement("button");
      skipBtn.type = "button";
      skipBtn.className = "bf-trap-prompt-btn";
      skipBtn.textContent = "Skip";
      skipBtn.addEventListener("click", () => cleanup(null));
      actions.appendChild(skipBtn);

      const cleanup = (entry) => {
        closeTrapPrompt();
        document.removeEventListener("keydown", onKeydown);
        resolve(entry);
      };

      function onKeydown(eventKey) {
        if (eventKey.key === "Escape") cleanup(null);
      }

      document.addEventListener("keydown", onKeydown);
      panel.append(title, message, list, actions);
      dialog.appendChild(panel);
      document.body.appendChild(dialog);
      _trapPromptEl = dialog;
      window.setTimeout(() => list.querySelector("button")?.focus(), 20);
    });
  }

  function pickAiEffectMonsterEntry(entries) {
    return entries[0] || null;
  }

  async function triggerEffectMonsterResponses(event, options = {}) {
    if (isDuelEnded()) return {};
    const owners = options.owner ? [options.owner] : ["player", "ai"];
    const result = {};

    for (const owner of owners) {
      const usedKeys = new Set(options.usedKeys || []);
      while (!isDuelEnded()) {
        const entries = eligibleEffectMonsterEntries(owner, event, usedKeys);
        if (!entries.length) break;

        const entry = owner === "player"
          ? await promptEffectMonsterActivation(entries, event)
          : pickAiEffectMonsterEntry(entries);
        if (!entry) break;

        const current = currentEffectEntry(entry);
        if (!current) {
          usedKeys.add(effectUsageKey(entry));
          continue;
        }
        usedKeys.add(effectUsageKey(current));
        await activateEffectMonster(current, event, result);
      }
    }

    return result;
  }

  async function notifyEffectTargeted(target, sourceOwner, sourceCard) {
    if (!target || target.zone !== "monster" || target.owner === sourceOwner) return;
    if (isProtectedFromEffectTarget(target.owner, target.zone, target.index, sourceOwner)) return;
    await triggerEffectMonsterResponses({
      type: "effect-target",
      sourceOwner,
      sourceCard,
      targetOwner: target.owner,
      targetZone: target.zone,
      targetIdx: target.index,
      targetCard: target.card
    }, { owner: target.owner });
  }

  function filteredFieldTargets(owner, zones, sourceOwner, options = {}) {
    return availableFieldTargets(owner, zones, { sourceOwner })
      .filter((entry) => {
        if (options.faceUpOnly && entry.card._faceDown) return false;
        return true;
      });
  }

  async function chooseEffectTarget(owner, title, entries) {
    if (!entries.length) return null;
    if (owner !== "player") {
      return [...entries].sort((a, b) => Math.max(cardAtk(b.card), cardDef(b.card)) - Math.max(cardAtk(a.card), cardDef(a.card)))[0] || null;
    }
    return chooseCardEntry(title, entries);
  }

  async function chooseMultipleEffectTargets(owner, sourceCard, entries, maxCount, title) {
    const targetLabel = entries.every((entry) => entry.zone === "monster")
      ? "monster"
      : entries.every((entry) => entry.zone === "spelltrap")
        ? "spell/trap card"
        : "card";
    return chooseFieldTargetsByClick(owner, entries, maxCount, {
      targetLabel,
      actionLabel: "Destroy",
      allowPartial: true,
      message: `Select highlighted ${targetLabel}${Math.min(maxCount, entries.length) === 1 ? "" : "s"} to destroy.`
    });
  }

  async function moveFieldCardToHand(owner, zone, slotIdx) {
    const field = fieldForZone(owner, zone);
    const card = field[slotIdx];
    if (!card) return false;
    const fromRect = readRect(slotsForZone(owner, zone)[slotIdx]);
    field[slotIdx] = null;
    card._faceDown = false;
    ownerHand(owner).push(card);
    renderField();
    if (owner === "player") renderPlayerHand();
    else renderAiHand();
    updateCounts();
    await animateCardMove(card, fromRect, ownerHandEl(owner)?.lastElementChild || ownerHandEl(owner), "is-draw", {
      faceDown: owner === "ai"
    });
    return true;
  }

  async function specialSummonFromCollection(owner, source, index, sourceElOrRect = null, options = {}) {
    const monsterZone = ownerMonsterField(owner);
    const slotIdx = monsterZone.indexOf(null);
    if (slotIdx < 0) return null;

    let collection = null;
    let fromElOrRect = sourceElOrRect;
    if (source === "hand") {
      collection = ownerHand(owner);
      fromElOrRect = fromElOrRect || ownerHandEl(owner)?.children[index];
    } else if (source === "deck") {
      collection = ownerDeck(owner);
      fromElOrRect = fromElOrRect || ownerDeckPile(owner);
    } else {
      collection = ownerGraveyard(owner);
      fromElOrRect = fromElOrRect || ownerGraveyardSlot(owner);
    }
    const [monster] = collection.splice(index, 1);
    if (!monster) return null;
    if (source === "graveyard") resetSpellStatBoostOnRevive(monster);

    const position = options.position || (owner === "ai" ? chooseAiSummonPosition(monster) : "attack");
    const summoned = { ...monster, _faceDown: false, _position: position };
    monsterZone[slotIdx] = summoned;
    renderField();
    if (owner === "player") renderPlayerHand();
    else renderAiHand();
    updateCounts();
    playSfx("monsterSummon");
    await animatePlaceCard(summoned, fromElOrRect, monsterSlots(owner)[slotIdx], false);
    await resolveSummonTrapResponses(owner, slotIdx, summoned, "special");
    return monsterZone[slotIdx] === summoned ? { card: summoned, slotIdx } : null;
  }

  async function chooseEffectRevivePosition(owner, monster) {
    if (owner !== "player") return chooseAiSummonPosition(monster);
    const useAttack = await promptTrapDecision(
      cardNameStr(monster),
      "Special summon this monster in which battle position?",
      "Attack",
      "Defense"
    );
    return useAttack ? "attack" : "defense";
  }

  async function returnGraveyardCardForEffect(owner, sourceCard, destination) {
    const graveyard = ownerGraveyard(owner);
    const entries = graveyard.map((card, index) => ({ owner, zone: "graveyard", index, card }));
    const picked = await chooseEffectTarget(owner, "Choose Graveyard Card", entries);
    if (!picked) return false;
    const actualIndex = graveyard.findIndex((card) => sameDuelCard(card, picked.card));
    if (actualIndex < 0) return false;
    const [card] = graveyard.splice(actualIndex, 1);
    if (destination === "deck") ownerDeck(owner).unshift(card);
    else ownerHand(owner).push(card);
    updateCounts();
    renderPlayerHand();
    renderAiHand();
    await animateCardMove(card, ownerGraveyardSlot(owner), destination === "deck" ? ownerDeckPile(owner) : ownerHandEl(owner)?.lastElementChild, destination === "deck" ? "is-to-deck" : "is-draw", {
      faceDown: owner === "ai"
    });
    showStatus(`${cardNameStr(sourceCard)} returned ${cardNameStr(card)} to the ${destination}.`, 1800);
    return true;
  }

  async function destroyEffectTargets(sourceOwner, sourceCard, targets) {
    const destroyed = [];
    for (const target of targets) {
      const current = fieldForZone(target.owner, target.zone)[target.index];
      if (!current) continue;
      await notifyEffectTargeted(target, sourceOwner, sourceCard);
      destroyed.push({ owner: target.owner, zone: target.zone, card: current });
      await destroyFieldCardToGraveyard(target.owner, target.zone, target.index, {
        faceDown: target.zone === "spelltrap",
        suppressEffectMonsterDestroy: true
      });
      await triggerEffectMonsterResponses({
        type: "destroyed",
        destroyedOwner: target.owner,
        destroyedZone: target.zone,
        destroyedCard: current,
        destroyerOwner: sourceOwner,
        sourceCard
      }, { owner: target.owner });
    }
    await notifyCardsDestroyedBy(sourceOwner, destroyed, sourceCard);
    return destroyed.length;
  }

  function isAttackedDestroyOpponentMonsterCombo(entry, triggerEvent) {
    return Boolean(
      triggerEvent?.type === "attack" &&
      triggerEvent.targetIdx !== null &&
      triggerEvent.defenderOwner === entry.owner &&
      Number(triggerEvent.targetIdx) === Number(entry.index) &&
      sameDuelCard(triggerEvent.defenderCard, entry.card) &&
      effectMonsterCause(entry.card) === "if this monster is attacked by the opponent" &&
      effectMonsterOutcome(entry.card) === EFFECT_MONSTER_DESTROY_OPPONENT_MONSTER
    );
  }

  async function destroyAttackedMonsterAfterEffect(entry, triggerEvent) {
    const field = ownerMonsterField(entry.owner);
    const current = field[entry.index];
    if (!current || !sameDuelCard(current, entry.card)) return false;

    triggerEvent.defenderDestroyedByEffectMonster = true;
    await sendMonsterToGraveyard(entry.owner, entry.index, {
      shatter: true,
      destroyerOwner: triggerEvent.attackerOwner,
      sourceCard: triggerEvent.attackerCard
    });
    triggerEvent.defenderDestroyedByEffectMonster = true;
    return true;
  }

  async function notifyCardsDestroyedBy(destroyerOwner, destroyedEntries, sourceCard = null) {
    const grouped = {};
    destroyedEntries.filter(Boolean).forEach((entry) => {
      if (!entry.owner || entry.owner === destroyerOwner) return;
      grouped[entry.owner] = grouped[entry.owner] || [];
      grouped[entry.owner].push(entry);
    });
    for (const owner of Object.keys(grouped)) {
      await triggerEffectMonsterResponses({
        type: "cards-destroyed",
        owner,
        destroyerOwner,
        cards: grouped[owner],
        sourceCard
      }, { owner });
    }
  }

  async function resolveEffectMonsterEffect(entry, triggerEvent) {
    const owner = entry.owner;
    const opponent = opponentOwner(owner);
    const card = entry.card;
    const outcome = effectMonsterOutcome(card);
    const params = effectMonsterParams(card);
    const levelRangeMatch = outcome.match(/^special summon a level (\d+) to (\d+) monster from hand\.$/i);

    if (levelRangeMatch) {
      const parsedFrom = boundedNumber(levelRangeMatch[1], 1, 1, 4);
      const parsedTo = boundedNumber(levelRangeMatch[2], 4, 1, 4);
      const minLevel = boundedNumber(params.levelFrom, parsedFrom, 1, 4);
      const maxLevel = boundedNumber(params.levelTo, parsedTo, 1, 4);
      const from = Math.min(minLevel, maxLevel);
      const to = Math.max(minLevel, maxLevel);
      const choices = ownerHand(owner)
        .map((candidate, index) => ({ owner, zone: "hand", index, card: candidate }))
        .filter(({ card: candidate }) => isMonsterCard(candidate) && cardLevel(candidate) >= from && cardLevel(candidate) <= to);
      const picked = await chooseEffectTarget(owner, `Special Summon Level ${from}-${to}`, choices);
      if (!picked) {
        showStatus(`${cardNameStr(card)} found no monster to special summon.`, 1700);
        return;
      }
      await specialSummonFromCollection(owner, "hand", picked.index, ownerHandEl(owner)?.children[picked.index]);
      return;
    }

    switch (outcome) {
      case "draw 1 card.":
        await drawCardVisible(owner);
        showStatus(`${cardNameStr(card)} drew 1 card.`, 1700);
        return;

      case "revive a monster from your graveyard.": {
        const choices = ownerGraveyard(owner)
          .map((candidate, index) => ({ owner, zone: "graveyard", index, card: candidate }))
          .filter(({ card: candidate }) => isMonsterCard(candidate) && !sameDuelCard(candidate, card));
        const picked = await chooseEffectTarget(owner, "Revive Monster", choices);
        if (!picked) {
          showStatus(`${cardNameStr(card)} found no other monster to revive.`, 1700);
          return;
        }
        const position = await chooseEffectRevivePosition(owner, picked.card);
        await specialSummonFromCollection(owner, "graveyard", picked.index, ownerGraveyardSlot(owner), { position });
        return;
      }

      case "send a monster/spell/trap card from graveyard to hand.":
      case "send a monster/spell/trap card from graveyard to deck.":
        await returnGraveyardCardForEffect(owner, card, outcome.endsWith("deck.") ? "deck" : "hand");
        return;

      case "reduce opponent's life points by up to 500.": {
        const amount = boundedNumber(params.lpAmount, 500, 0, 500);
        await Promise.all([quakeOwnerField(opponent), adjustLife(opponent, amount)]);
        showStatus(`${cardNameStr(card)} dealt ${amount} damage.`, 1800);
        return;
      }

      case EFFECT_MONSTER_DESTROY_OPPONENT_MONSTER: {
        const targets = filteredFieldTargets(opponent, ["monster"], owner);
        const selected = await chooseFieldTargetsByClick(owner, targets, 1, {
          targetLabel: "monster",
          message: "Select a highlighted monster to destroy."
        });
        if (!selected.length) return;
        await destroyEffectTargets(owner, card, selected);
        if (isAttackedDestroyOpponentMonsterCombo(entry, triggerEvent)) {
          await destroyAttackedMonsterAfterEffect(entry, triggerEvent);
        }
        return;
      }

      case "destroy an opponent's spell/trap card in the field.": {
        const targets = filteredFieldTargets(opponent, ["spelltrap"], owner);
        const selected = await chooseFieldTargetsByClick(owner, targets, 1, {
          targetLabel: "spell/trap card",
          message: "Select a highlighted spell/trap card to destroy."
        });
        if (!selected.length) return;
        await destroyEffectTargets(owner, card, selected);
        return;
      }

      case "return a monster card from field to opponent's hand.": {
        const targets = filteredFieldTargets(opponent, ["monster"], owner);
        const picked = await chooseOneFieldTargetByClick(owner, targets, {
          targetLabel: "monster",
          actionLabel: "Return",
          message: "Select a highlighted monster to return to hand."
        });
        if (!picked) return;
        await notifyEffectTargeted(picked, owner, card);
        await moveFieldCardToHand(picked.owner, picked.zone, picked.index);
        return;
      }

      case "return a spell/trap card from field to opponent's hand.": {
        const targets = filteredFieldTargets(opponent, ["spelltrap"], owner);
        const picked = await chooseOneFieldTargetByClick(owner, targets, {
          targetLabel: "spell/trap card",
          actionLabel: "Return",
          message: "Select a highlighted spell/trap card to return to hand."
        });
        if (!picked) return;
        await moveFieldCardToHand(picked.owner, picked.zone, picked.index);
        return;
      }

      case "select and destroy 1-2 opponent's monsters.": {
        const targets = filteredFieldTargets(opponent, ["monster"], owner);
        const selected = await chooseMultipleEffectTargets(owner, card, targets, 2, "Destroy Opponent Monster");
        await destroyEffectTargets(owner, card, selected);
        return;
      }

      case "select and destroy 1-2 opponent's spell/trap cards.": {
        const targets = filteredFieldTargets(opponent, ["spelltrap"], owner);
        const selected = await chooseMultipleEffectTargets(owner, card, targets, 2, "Destroy Spell / Trap");
        await destroyEffectTargets(owner, card, selected);
        return;
      }

      case "this monster can attack twice during this turn's battle phase.":
        card._doubleAttackUntilTurn = state.turn;
        renderField();
        showStatus(`${cardNameStr(card)} can attack twice this turn.`, 1700);
        return;

      case "increase this monster's attack by 1000 for 2 turns.":
        addTemporaryStatEffect(card, "attack", 1000, state.turn + 1);
        renderField();
        showStatus(`${cardNameStr(card)} gained 1000 ATK for 2 turns.`, 1700);
        return;

      case "increase this monster's defense by 1000 for 2 turns.":
        addTemporaryStatEffect(card, "defense", 1000, state.turn + 1);
        renderField();
        showStatus(`${cardNameStr(card)} gained 1000 DEF for 2 turns.`, 1700);
        return;

      case "reduce the attack of an opponent's faceup monster by 1000 during this turn's battle phase.": {
        const targets = filteredFieldTargets(opponent, ["monster"], owner, { faceUpOnly: true });
        const picked = await chooseOneFieldTargetByClick(owner, targets, {
          targetLabel: "face-up monster",
          actionLabel: "Apply",
          message: "Select a highlighted face-up monster to reduce its ATK."
        });
        if (!picked) return;
        await notifyEffectTargeted(picked, owner, card);
        addTemporaryStatEffect(picked.card, "attack", -1000, state.turn, { battleOnly: true });
        renderField();
        return;
      }

      case "reduce the defense of an opponent's faceup monster by 1000 during this turn's battle phase.": {
        const targets = filteredFieldTargets(opponent, ["monster"], owner, { faceUpOnly: true });
        const picked = await chooseOneFieldTargetByClick(owner, targets, {
          targetLabel: "face-up monster",
          actionLabel: "Apply",
          message: "Select a highlighted face-up monster to reduce its DEF."
        });
        if (!picked) return;
        await notifyEffectTargeted(picked, owner, card);
        addTemporaryStatEffect(picked.card, "defense", -1000, state.turn, { battleOnly: true });
        renderField();
        return;
      }

      case EFFECT_MONSTER_COMBINED_ATTACK_BOOST: {
        const targets = ownerMonsterField(owner)
          .map((candidate, index) => ({ owner, zone: "monster", index, card: candidate }))
          .filter(({ card: candidate }) => candidate && !sameDuelCard(candidate, card));
        const picked = await chooseOneFieldTargetByClick(owner, targets, {
          targetLabel: "monster",
          actionLabel: "Select",
          message: "Select a highlighted monster you control."
        });
        if (!picked) return;
        const amount = Math.floor((cardAtk(card) + cardAtk(picked.card)) * 0.5);
        addTemporaryStatEffect(card, "attack", amount, state.turn + 1);
        renderField();
        showStatus(`${cardNameStr(card)} gained ${amount} ATK.`, 1800);
        return;
      }

      case "this monster cannot be targeted by card effects for 2 turns after summon (including the turn it was summoned).":
        card._effectTargetImmuneUntilTurn = state.turn + 1;
        renderField();
        showStatus(`${cardNameStr(card)} cannot be targeted by effects for 2 turns.`, 1800);
        return;

      case "this monster cannot be targeted by an attack for 2 turns after summon (including the turn it was summoned).":
        card._attackTargetImmuneUntilTurn = state.turn + 1;
        renderField();
        showStatus(`${cardNameStr(card)} cannot be targeted by attacks for 2 turns.`, 1800);
        return;

      case "special summon 1-2 level 4 or below monsters from hand.":
      case "special summon 1-2 level 4 or below monsters from deck.": {
        const source = outcome.endsWith("deck.") ? "deck" : "hand";
        const collection = source === "deck" ? ownerDeck(owner) : ownerHand(owner);
        let summoned = 0;
        while (summoned < 2 && ownerMonsterField(owner).some((slot) => slot === null)) {
          const choices = collection
            .map((candidate, index) => ({ owner, zone: source, index, card: candidate }))
            .filter(({ card: candidate }) => isMonsterCard(candidate) && cardLevel(candidate) <= 4);
          const picked = await chooseEffectTarget(owner, `Special Summon ${source === "deck" ? "from Deck" : "from Hand"}`, choices);
          if (!picked) break;
          await specialSummonFromCollection(owner, source, picked.index, source === "deck" ? ownerDeckPile(owner) : ownerHandEl(owner)?.children[picked.index]);
          summoned++;
          if (owner !== "player") continue;
          if (summoned < 2 && choices.length > 1 && ownerMonsterField(owner).some((slot) => slot === null)) {
            const keepGoing = await promptTrapDecision(cardNameStr(card), "Special summon another level 4 or below monster?", "Summon Another", "Resolve");
            if (!keepGoing) break;
          }
        }
        return;
      }

      default:
        showStatus(`${cardNameStr(card)} has no supported effect monster behavior yet.`, 1800);
    }
  }

  async function activateEffectMonster(entry, triggerEvent, result = {}) {
    const current = currentEffectEntry(entry);
    if (!current || !canUseEffectMonster(current)) return result;

    state.resolvingEffectMonster = true;
    markEffectMonsterUsed(current);
    renderField();
    playSfx("monsterEffectUsed");
    showStatus(`${controllerName(current.owner)} activated ${cardNameStr(current.card)}.`, 1600);

    try {
      const sourceZone = current.location === "field" ? "monster" : "";
      const sourceIdx = current.location === "field" ? current.index : null;
      await triggerEffectMonsterResponses({
        type: "effect-activated",
        effectOwner: current.owner,
        sourceOwner: current.owner,
        sourceZone,
        sourceIdx,
        sourceCard: current.card,
        sourceType: "effect-monster"
      }, { owner: opponentOwner(current.owner), usedKeys: new Set([effectUsageKey(current)]) });

      const trapResult = await triggerTrapResponses({
        type: "effect",
        effectOwner: current.owner,
        sourceOwner: current.owner,
        sourceZone,
        sourceIdx,
        sourceCard: current.card
      });
      if (trapResult.negateEffect) {
        showStatus(`${cardNameStr(current.card)} was negated by a trap.`, 1800);
        return { ...result, negated: true };
      }

      await resolveEffectMonsterEffect(current, triggerEvent);
      return result;
    } finally {
      state.resolvingEffectMonster = false;
      updateCounts();
      renderPlayerHand();
      renderAiHand();
      renderField();
      if (state.defeatedOwner) endGame(defeatMessage(state.defeatedOwner));
    }
  }

  function closeTrapPrompt() {
    if (_trapPromptEl) {
      _trapPromptEl.remove();
      _trapPromptEl = null;
    }
  }

  function opponentOwner(owner) {
    return owner === "player" ? "ai" : "player";
  }

  function isTrapReady(owner, slotIdx) {
    const card = ownerSpellTrapField(owner)[slotIdx];
    const setTurn = Number(card?._setTurn || 0);
    const setterTurnEnded = setTurn < state.turn || (setTurn === state.turn && state.activePlayer !== owner);
    return Boolean(
      card &&
      cardTypeName(card) === "trap" &&
      card._faceDown !== false &&
      setterTurnEnded
    );
  }

  function trapEventActorOwner(event) {
    if (event.type === "attack") return event.attackerOwner;
    if (event.type === "summon") return event.summonerOwner;
    if (event.type === "effect") return event.effectOwner;
    return "";
  }

  function trapEventLabel(event) {
    if (event.type === "attack") {
      const attacker = ownerMonsterField(event.attackerOwner)[event.attackerIdx] || event.attackerCard;
      if (event.targetIdx === null) {
        return `${cardNameStr(attacker)} is attacking directly.`;
      }
      const defender = ownerMonsterField(event.defenderOwner)[event.targetIdx] || event.defenderCard;
      return `${cardNameStr(attacker)} is attacking ${cardNameStr(defender)}.`;
    }
    if (event.type === "summon") {
      return `${controllerName(event.summonerOwner)} summoned ${cardNameStr(event.summonedCard)}.`;
    }
    if (event.type === "effect") {
      return `${controllerName(event.effectOwner)} activated ${cardNameStr(event.sourceCard)}.`;
    }
    return "A trap can respond to this action.";
  }

  function canTrapRespondToEvent(owner, slotIdx, event) {
    if (!isTrapReady(owner, slotIdx)) return false;
    const card = ownerSpellTrapField(owner)[slotIdx];
    const effect = trapEffectName(card);
    const actorOwner = trapEventActorOwner(event);
    if (!actorOwner || actorOwner !== opponentOwner(owner)) return false;

    if (event.type === "attack") {
      if (event.attackerOwner !== actorOwner) return false;
      if (effect === "boost-on-attack") {
        return event.targetIdx !== null
          && event.defenderOwner === owner
          && Boolean(ownerMonsterField(owner)[event.targetIdx]);
      }
      return [
        "negate-attack",
        "negate-attack-damage",
        "destroy-on-attack",
        "decrease-attacker"
      ].includes(effect);
    }

    if (event.type === "summon") {
      const kind = event.summonKind || "normal";
      if (effect === "destroy-on-summon") return kind === "normal" || kind === "special";
      if (effect === "destroy-weaker") return ["normal", "special", "flip"].includes(kind);
      if (effect === "negate-summon") return ["normal", "special", "flip"].includes(kind);
      return false;
    }

    if (event.type === "effect") {
      return [
        "negate-effect",
        "negate-effect-destroy",
        "destroy-on-effect"
      ].includes(effect);
    }

    return false;
  }

  function eligibleTrapEntries(owner, event) {
    return ownerSpellTrapField(owner)
      .map((card, slotIdx) => ({ owner, slotIdx, card }))
      .filter((entry) => entry.card && canTrapRespondToEvent(owner, entry.slotIdx, event));
  }

  function trapHasUsefulAiOutcome(entry, event) {
    const effect = trapEffectName(entry.card);
    if (["negate-attack", "negate-attack-damage", "decrease-attacker", "negate-summon", "negate-effect", "negate-effect-destroy"].includes(effect)) {
      return true;
    }
    if (effect === "boost-on-attack") {
      return event.targetIdx !== null && Boolean(ownerMonsterField(entry.owner)[event.targetIdx]);
    }
    if (effect === "destroy-on-attack") {
      return ownerMonsterField(event.attackerOwner).some((card, index) => card && index !== event.attackerIdx);
    }
    if (effect === "destroy-on-summon") {
      return ownerMonsterField(event.summonerOwner).some((card, index) => card && index !== event.summonedIdx);
    }
    if (effect === "destroy-weaker") {
      const summoned = ownerMonsterField(event.summonerOwner)[event.summonedIdx];
      if (!summoned) return false;
      const otherExists = ownerMonsterField(event.summonerOwner).some((card, index) => (
        card && index !== event.summonedIdx
      ));
      const weaker = ownerMonsterField(event.summonerOwner).some((card, index) => (
        card && index !== event.summonedIdx && cardAtk(card) < cardAtk(summoned)
      ));
      return weaker || !otherExists;
    }
    if (effect === "destroy-on-effect") {
      return ownerMonsterField(event.effectOwner).some(Boolean);
    }
    return false;
  }

  function promptTrapActivation(entry, event) {
    closeTrapPrompt();

    return new Promise((resolve) => {
      const dialog = document.createElement("div");
      dialog.className = "bf-trap-prompt";
      dialog.setAttribute("role", "dialog");
      dialog.setAttribute("aria-modal", "true");
      dialog.setAttribute("aria-label", `Activate trap ${cardNameStr(entry.card)}?`);

      const panel = document.createElement("div");
      panel.className = "bf-trap-prompt-panel";

      const title = document.createElement("div");
      title.className = "bf-trap-prompt-title";
      title.textContent = "Activate Trap?";

      const cardName = document.createElement("div");
      cardName.className = "bf-trap-prompt-card";
      cardName.textContent = cardNameStr(entry.card);

      const cardPreview = createTrapPromptCard(entry.card);

      const message = document.createElement("div");
      message.className = "bf-trap-prompt-message";
      message.textContent = trapEventLabel(event);

      const actions = document.createElement("div");
      actions.className = "bf-trap-prompt-actions";

      const activateBtn = document.createElement("button");
      activateBtn.type = "button";
      activateBtn.className = "bf-trap-prompt-btn is-activate";
      activateBtn.textContent = "Activate";

      const skipBtn = document.createElement("button");
      skipBtn.type = "button";
      skipBtn.className = "bf-trap-prompt-btn";
      skipBtn.textContent = "Skip";

      const cleanup = (answer) => {
        closeTrapPrompt();
        document.removeEventListener("keydown", onKeydown);
        resolve(answer);
      };

      function onKeydown(eventKey) {
        if (eventKey.key === "Escape") cleanup(false);
      }

      activateBtn.addEventListener("click", () => cleanup(true));
      skipBtn.addEventListener("click", () => cleanup(false));
      document.addEventListener("keydown", onKeydown);

      actions.append(activateBtn, skipBtn);
      panel.append(title, cardName, cardPreview, message, actions);
      dialog.appendChild(panel);
      document.body.appendChild(dialog);
      _trapPromptEl = dialog;
      window.setTimeout(() => activateBtn.focus(), 20);
    });
  }

  function promptTrapDecision(titleText, messageText, confirmText = "Select", cancelText = "Resolve") {
    closeTrapPrompt();

    return new Promise((resolve) => {
      const dialog = document.createElement("div");
      dialog.className = "bf-trap-prompt";
      dialog.setAttribute("role", "dialog");
      dialog.setAttribute("aria-modal", "true");

      const panel = document.createElement("div");
      panel.className = "bf-trap-prompt-panel";

      const title = document.createElement("div");
      title.className = "bf-trap-prompt-title";
      title.textContent = titleText;

      const message = document.createElement("div");
      message.className = "bf-trap-prompt-message";
      message.textContent = messageText;

      const actions = document.createElement("div");
      actions.className = "bf-trap-prompt-actions";

      const confirmBtn = document.createElement("button");
      confirmBtn.type = "button";
      confirmBtn.className = "bf-trap-prompt-btn is-activate";
      confirmBtn.textContent = confirmText;

      const cancelBtn = document.createElement("button");
      cancelBtn.type = "button";
      cancelBtn.className = "bf-trap-prompt-btn";
      cancelBtn.textContent = cancelText;

      const cleanup = (answer) => {
        closeTrapPrompt();
        document.removeEventListener("keydown", onKeydown);
        resolve(answer);
      };

      function onKeydown(eventKey) {
        if (eventKey.key === "Escape") cleanup(false);
      }

      confirmBtn.addEventListener("click", () => cleanup(true));
      cancelBtn.addEventListener("click", () => cleanup(false));
      document.addEventListener("keydown", onKeydown);

      actions.append(confirmBtn, cancelBtn);
      panel.append(title, message, actions);
      dialog.appendChild(panel);
      document.body.appendChild(dialog);
      _trapPromptEl = dialog;
      window.setTimeout(() => confirmBtn.focus(), 20);
    });
  }

  function chooseCardEntry(title, entries) {
    return new Promise((resolve) => {
      const opened = openCardChoiceDialog(title, entries, (entry) => resolve(entry), () => resolve(null));
      if (!opened) resolve(null);
    });
  }

  function createTrapPromptCard(card) {
    const preview = document.createElement("article");
    preview.className = "bf-trap-preview-card";

    const type = cardTypeName(card);
    const isMonster = type === "monster";

    const art = makeArtEl(card, "bf-trap-preview-art");
    preview.appendChild(art);

    const body = document.createElement("div");
    body.className = "bf-trap-preview-body";

    const typeEl = document.createElement("div");
    typeEl.className = `bf-trap-preview-type is-${type}`;
    typeEl.textContent = cardTypeLabel(card);
    body.appendChild(typeEl);

    const nameEl = document.createElement("div");
    nameEl.className = "bf-trap-preview-name";
    nameEl.textContent = cardNameStr(card);
    body.appendChild(nameEl);

    if (isMonster) {
      const stats = document.createElement("div");
      stats.className = "bf-trap-preview-stats";
      stats.innerHTML = `<span>LV ${cardLevel(card)}</span><span>ATK ${cardAtk(card)}</span><span>DEF ${cardDef(card)}</span>`;
      body.appendChild(stats);
    }

    const desc = document.createElement("div");
    desc.className = "bf-trap-preview-desc";
    desc.textContent = card.shortDescription || card.spellEffectDescription || card.trapEffectDescription
      || card.effectDescription || card.effect || "No effect text has been written for this card.";
    body.appendChild(desc);

    preview.appendChild(body);
    return preview;
  }

  function closeCardHoldPreview() {
    if (!_holdPreviewEl) return;
    _holdPreviewEl.remove();
    _holdPreviewEl = null;
  }

  function openCardHoldPreview(card) {
    if (!card) return;
    closeCardHoldPreview();
    closeHandMenu();
    showCardInfo(card);

    const overlay = document.createElement("div");
    overlay.className = "bf-hold-preview";
    overlay.setAttribute("role", "dialog");
    overlay.setAttribute("aria-modal", "true");
    overlay.setAttribute("aria-label", `${cardNameStr(card)} card details`);

    const preview = createTrapPromptCard(card);
    preview.classList.add("is-hold-preview");
    overlay.appendChild(preview);
    overlay.addEventListener("click", closeCardHoldPreview);
    document.body.appendChild(overlay);
    _holdPreviewEl = overlay;
  }

  function cardClickWasHeld() {
    return Date.now() < suppressCardClickUntil;
  }

  function bindCardHoldPreview(element, card) {
    if (!element || !card) return;
    let timer = null;
    let previewOpened = false;
    let startX = 0;
    let startY = 0;

    const clearTimer = () => {
      if (timer !== null) {
        window.clearTimeout(timer);
        timer = null;
      }
    };

    const finish = () => {
      clearTimer();
      if (previewOpened) {
        suppressCardClickUntil = Date.now() + 450;
        previewOpened = false;
        closeCardHoldPreview();
      }
    };

    element.addEventListener("pointerdown", (event) => {
      if (event.pointerType === "mouse" && event.button !== 0) return;
      startX = event.clientX;
      startY = event.clientY;
      previewOpened = false;
      element.setPointerCapture?.(event.pointerId);
      timer = window.setTimeout(() => {
        previewOpened = true;
        suppressCardClickUntil = Date.now() + 450;
        openCardHoldPreview(card);
      }, 420);
    });

    element.addEventListener("pointermove", (event) => {
      if (previewOpened || timer === null) return;
      if (Math.hypot(event.clientX - startX, event.clientY - startY) > 10) clearTimer();
    });
    element.addEventListener("pointerup", finish);
    element.addEventListener("pointercancel", finish);
    element.addEventListener("lostpointercapture", finish);
    element.addEventListener("contextmenu", (event) => {
      if (previewOpened || cardClickWasHeld()) event.preventDefault();
    });
  }

  async function animateTrapCardReveal(card) {
    if (!card) return;

    const overlay = document.createElement("div");
    overlay.className = "bf-trap-reveal";

    const panel = document.createElement("div");
    panel.className = "bf-trap-reveal-panel";

    const title = document.createElement("div");
    title.className = "bf-trap-reveal-title";
    title.textContent = "Trap Activated";

    const preview = createTrapPromptCard(card);
    preview.classList.add("is-reveal");

    panel.append(title, preview);
    overlay.appendChild(panel);
    document.body.appendChild(overlay);

    requestAnimationFrame(() => overlay.classList.add("is-open"));
    await sleep(TRAP_REVEAL_MS);
    overlay.classList.remove("is-open");
    await sleep(180);
    overlay.remove();
  }

  async function chooseTrapTargets(trapOwner, trapCard, entries, maxCount, title) {
    const targetLabel = entries.every((entry) => entry.zone === "monster")
      ? "monster"
      : entries.every((entry) => entry.zone === "spelltrap")
        ? "spell/trap card"
        : "card";
    return chooseFieldTargetsByClick(trapOwner, entries, maxCount, {
      targetLabel,
      actionLabel: "Destroy",
      allowPartial: true,
      message: `Select highlighted ${targetLabel}${Math.min(maxCount, entries.length) === 1 ? "" : "s"} to destroy.`
    });
  }

  async function destroyTrapTargets(targets, destroyerOwner = "", sourceCard = null) {
    for (const target of targets) {
      if (!fieldForZone(target.owner, target.zone)[target.index]) continue;
      if (destroyerOwner && isProtectedFromEffectTarget(target.owner, target.zone, target.index, destroyerOwner)) continue;
      if (destroyerOwner) await notifyEffectTargeted(target, destroyerOwner, sourceCard);
      await destroyFieldCardToGraveyard(target.owner, target.zone, target.index, {
        faceDown: target.zone === "spelltrap",
        destroyerOwner,
        sourceCard
      });
    }
  }

  async function moveFieldMonsterToDestination(owner, slotIdx, destination) {
    const field = ownerMonsterField(owner);
    const card = field[slotIdx];
    if (!card) return false;

    const fromRect = readRect(monsterSlots(owner)[slotIdx]);
    field[slotIdx] = null;

    let targetEl = null;
    if (destination === "deck") {
      ownerDeck(owner).unshift(card);
      targetEl = ownerDeckPile(owner);
    } else {
      ownerHand(owner).push(card);
      if (owner === "player") renderPlayerHand();
      else renderAiHand();
      targetEl = ownerHandEl(owner)?.lastElementChild || ownerHandEl(owner);
    }

    renderField();
    updateCounts();
    await animateCardMove(card, fromRect, targetEl, destination === "deck" ? "is-to-deck" : "is-draw", {
      faceDown: owner === "ai" && destination !== "deck"
    });
    return true;
  }

  async function resolveTrapEffect(entry, event) {
    const card = entry.card;
    const effect = trapEffectName(card);
    const params = trapParams(card);
    const outcome = {};

    switch (effect) {
      case "negate-attack":
        outcome.cancelAttack = true;
        await animateTrapShieldBlock(event);
        showStatus(`${cardNameStr(card)} stopped the attack.`, 1800);
        break;

      case "negate-attack-damage": {
        const attacker = ownerMonsterField(event.attackerOwner)[event.attackerIdx] || event.attackerCard;
        const damage = Math.max(0, cardAtk(attacker));
        outcome.cancelAttack = true;
        await animateTrapShieldBlock(event);
        await Promise.all([
          quakeOwnerField(event.attackerOwner),
          adjustLife(event.attackerOwner, damage)
        ]);
        showStatus(`${cardNameStr(card)} stopped the attack and dealt ${damage} damage.`, 2000);
        break;
      }

      case "destroy-on-summon": {
        const maxTargets = boundedNumber(params.destroyCount, 1, 1, 2);
        const targets = ownerMonsterField(event.summonerOwner)
          .map((targetCard, index) => ({ owner: event.summonerOwner, zone: "monster", index, card: targetCard }))
          .filter((target) => target.card && target.index !== event.summonedIdx);
        const selected = await chooseTrapTargets(entry.owner, card, targets, maxTargets, "Destroy Opponent's Monster");
        if (!selected.length) {
          showStatus(`${cardNameStr(card)} found no other opponent monsters to destroy.`, 1800);
          break;
        }
        await destroyTrapTargets(selected, entry.owner, card);
        showStatus(`${cardNameStr(card)} destroyed ${selected.length} monster${selected.length === 1 ? "" : "s"}.`, 1800);
        break;
      }

      case "destroy-on-attack": {
        const targets = ownerMonsterField(event.attackerOwner)
          .map((targetCard, index) => ({ owner: event.attackerOwner, zone: "monster", index, card: targetCard }))
          .filter((target) => target.card && target.index !== event.attackerIdx);
        const selected = await chooseTrapTargets(entry.owner, card, targets, 1, "Destroy Opponent's Monster");
        if (!selected.length) {
          showStatus(`${cardNameStr(card)} found no other opponent monster to destroy.`, 1800);
          break;
        }
        await destroyTrapTargets(selected, entry.owner, card);
        showStatus(`${cardNameStr(card)} destroyed 1 monster.`, 1800);
        break;
      }

      case "destroy-weaker": {
        const summoned = ownerMonsterField(event.summonerOwner)[event.summonedIdx];
        if (!summoned) break;
        const summonedAtk = cardAtk(summoned);
        const otherTargets = ownerMonsterField(event.summonerOwner)
          .map((targetCard, index) => ({ owner: event.summonerOwner, zone: "monster", index, card: targetCard }))
          .filter((target) => target.card && target.index !== event.summonedIdx);
        const weakerTargets = otherTargets.filter((target) => cardAtk(target.card) < summonedAtk);

        if (weakerTargets.length) {
          await destroyTrapTargets(weakerTargets, entry.owner, card);
          showStatus(`${cardNameStr(card)} destroyed ${weakerTargets.length} weaker monster${weakerTargets.length === 1 ? "" : "s"}.`, 1800);
        } else if (!otherTargets.length) {
          await destroyFieldCardToGraveyard(event.summonerOwner, "monster", event.summonedIdx, {
            destroyerOwner: entry.owner,
            sourceCard: card
          });
          outcome.summonedRemoved = true;
          showStatus(`${cardNameStr(card)} destroyed the summoned monster instead.`, 1800);
        } else {
          showStatus(`${cardNameStr(card)} found no weaker monsters to destroy.`, 1800);
        }
        break;
      }

      case "negate-effect":
        outcome.negateEffect = true;
        showStatus(`${cardNameStr(card)} negated ${cardNameStr(event.sourceCard)}.`, 1800);
        break;

      case "negate-effect-destroy":
        outcome.negateEffect = true;
        outcome.destroyEffectSource = true;
        if (event.sourceZone && Number.isInteger(event.sourceIdx)) {
          const sourceOwner = event.sourceOwner || event.effectOwner;
          const sourceField = fieldForZone(sourceOwner, event.sourceZone);
          if (sourceField[event.sourceIdx] === event.sourceCard) {
            await destroyFieldCardToGraveyard(sourceOwner, event.sourceZone, event.sourceIdx, {
              faceDown: event.sourceZone === "spelltrap",
              destroyerOwner: entry.owner,
              sourceCard: card
            });
          }
        }
        showStatus(`${cardNameStr(card)} negated and destroyed ${cardNameStr(event.sourceCard)}.`, 1900);
        break;

      case "destroy-on-effect": {
        const targets = ownerMonsterField(event.effectOwner)
          .map((targetCard, index) => ({ owner: event.effectOwner, zone: "monster", index, card: targetCard }))
          .filter((target) => target.card);
        const selected = await chooseTrapTargets(entry.owner, card, targets, 1, "Destroy Opponent's Monster");
        if (!selected.length) {
          showStatus(`${cardNameStr(card)} found no monster to destroy.`, 1800);
          break;
        }
        await destroyTrapTargets(selected, entry.owner, card);
        showStatus(`${cardNameStr(card)} destroyed 1 monster.`, 1800);
        break;
      }

      case "negate-summon": {
        const destination = params.summonDest === "deck" ? "deck" : "hand";
        const moved = await moveFieldMonsterToDestination(event.summonerOwner, event.summonedIdx, destination);
        if (moved) {
          outcome.negateSummon = true;
          outcome.summonedRemoved = true;
          showStatus(`${cardNameStr(card)} returned the summoned monster to the ${destination}.`, 1900);
        }
        break;
      }

      case "boost-on-attack": {
        const target = ownerMonsterField(entry.owner)[event.targetIdx];
        if (!target) break;
        const statType = params.statType === "defense" ? "defense" : "attack";
        const amount = statType === "defense"
          ? boundedNumber(params.defBoost, 100, 0, 700)
          : boundedNumber(params.atkBoost, 100, 0, 500);
        if (statType === "defense") target.defensePoints = cardDef(target) + amount;
        else target.attackPoints = cardAtk(target) + amount;
        target._justModeChanged = true;
        renderField();
        showStatus(`${cardNameStr(card)} gave ${cardNameStr(target)} ${amount} ${statType === "defense" ? "DEF" : "ATK"}.`, 1800);
        break;
      }

      case "decrease-attacker": {
        const attacker = ownerMonsterField(event.attackerOwner)[event.attackerIdx];
        if (!attacker) break;
        const amount = boundedNumber(params.atkDecrease, 100, 0, 500);
        attacker.attackPoints = Math.max(0, cardAtk(attacker) - amount);
        attacker._justModeChanged = true;
        renderField();
        showStatus(`${cardNameStr(card)} lowered ${cardNameStr(attacker)} by ${amount} ATK.`, 1800);
        break;
      }

      default:
        showStatus(`${cardNameStr(card)} has no trap effect selected.`, 1600);
    }

    return outcome;
  }

  function mergeTrapOutcome(result, outcome) {
    if (!outcome) return result;
    Object.keys(outcome).forEach((key) => {
      result[key] = result[key] || outcome[key];
    });
    return result;
  }

  async function activateTrap(entry, event) {
    const field = ownerSpellTrapField(entry.owner);
    if (field[entry.slotIdx] !== entry.card) return {};

    const card = entry.card;
    const effect = trapEffectName(card);
    card._faceDown = false;
    card._justFlipped = true;
    renderField();
    playSfx("spellTrapActivate");
    showStatus(`${controllerName(entry.owner)} activated ${cardNameStr(card)}!`, 1600);
    await sleep(220);
    if (isNegatingTrapEffect(effect)) {
      await animateTrapCardReveal(card);
    }

    await triggerEffectMonsterResponses({
      type: "effect-activated",
      effectOwner: entry.owner,
      sourceOwner: entry.owner,
      sourceZone: "spelltrap",
      sourceIdx: entry.slotIdx,
      sourceCard: card,
      sourceType: "trap"
    }, { owner: opponentOwner(entry.owner) });
    await triggerEffectMonsterResponses({
      type: "spelltrap-activated",
      effectOwner: entry.owner,
      sourceOwner: entry.owner,
      sourceZone: "spelltrap",
      sourceIdx: entry.slotIdx,
      sourceCard: card,
      sourceType: "trap"
    }, { owner: opponentOwner(entry.owner) });

    const outcome = await resolveTrapEffect(entry, event);

    if (field[entry.slotIdx] === card) {
      await sendFieldCardToGraveyard(entry.owner, "spelltrap", entry.slotIdx, { faceDown: false });
    }
    updateCounts();
    renderField();
    return outcome;
  }

  async function triggerTrapResponses(event) {
    const actorOwner = trapEventActorOwner(event);
    const trapOwner = opponentOwner(actorOwner);
    if (!actorOwner || isDuelEnded()) return {};

    const result = {};
    const promptedKeys = new Set();
    state.resolvingTrap = true;

    try {
      while (!isDuelEnded()) {
        const entries = eligibleTrapEntries(trapOwner, event)
          .filter((entry) => !promptedKeys.has(`${entry.owner}:${entry.slotIdx}`));
        if (!entries.length) break;

        let selected = null;
        for (const entry of entries) {
          const key = `${entry.owner}:${entry.slotIdx}`;
          if (trapOwner === "player") {
            const shouldActivate = await promptTrapActivation(entry, event);
            promptedKeys.add(key);
            if (shouldActivate) {
              selected = entry;
              break;
            }
          } else {
            promptedKeys.add(key);
            if (trapHasUsefulAiOutcome(entry, event)) {
              selected = entry;
              break;
            }
          }
        }

        if (!selected) break;
        const outcome = await activateTrap(selected, event);
        mergeTrapOutcome(result, outcome);
        if (result.cancelAttack || result.negateEffect || result.negateSummon) break;
      }
    } finally {
      state.resolvingTrap = false;
    }

    if (state.defeatedOwner) endGame(defeatMessage(state.defeatedOwner));
    return result;
  }

  function canFlipSummon(slotIdx) {
    const card = state.playerMonster[slotIdx];
    return Boolean(card && card._faceDown && isPlayerMainPhase() && Number(card._setTurn || 0) < state.turn);
  }

  function explainFlipSummonBlocked(slotIdx) {
    const card = state.playerMonster[slotIdx];
    if (!card || !card._faceDown) return "";
    if (!isPlayerMainPhase()) return "You can flip summon during your Main Phase";
    if (Number(card._setTurn || 0) >= state.turn) return "You can flip summon that monster on a later turn";
    return "";
  }

  function explainModeChangeBlocked(slotIdx) {
    const card = state.playerMonster[slotIdx];
    if (!card || card._faceDown) return "";
    if (state.activePlayer !== "player") return "You can only change modes during your turn.";
    if (state.phase !== "main1" && state.phase !== "main2") return "You can change modes during your Main Phase.";
    if (state.battleEnteredThisTurn) return "Monsters cannot change mode after the Battle Phase.";
    if (state.resolvingBattle) return "Finish the current battle first.";
    if (state.monstersChangedModeThisTurn.has(modeChangeKey("player", slotIdx))) {
      return "That monster already changed mode this turn.";
    }
    return "";
  }

  async function flipSummon(slotIdx, position) {
    if (!canFlipSummon(slotIdx)) {
      const message = explainFlipSummonBlocked(slotIdx);
      if (message) showStatus(message);
      return;
    }

    const card = state.playerMonster[slotIdx];
    card._faceDown = false;
    card._position = position;
    delete card._setTurn;
    card._justFlipped = true;
    closeHandMenu();
    renderField();
    playSfx("monsterSummon");
    showStatus(`${cardNameStr(card)} was flip summoned in ${position === "attack" ? "Attack" : "Defense"} Position!`, 1700);
    await resolveSummonTrapResponses("player", slotIdx, card, "flip");
  }

  function openFlipSummonMenu(slotIdx, anchorEl) {
    closeHandMenu();
    const blockedMessage = explainFlipSummonBlocked(slotIdx);
    if (!canFlipSummon(slotIdx)) {
      if (blockedMessage) showStatus(blockedMessage);
      return;
    }

    const menu = document.createElement("div");
    menu.className = "bf-hand-menu";
    _handMenuEl = menu;

    const label = document.createElement("div");
    label.className = "bf-hand-menu-label";
    label.textContent = "Flip Summon";
    menu.appendChild(label);

    [["Attack Position", "attack"], ["Defense Position", "defense"]].forEach(([text, position]) => {
      const btn = document.createElement("button");
      btn.className = "bf-hand-menu-item";
      btn.type = "button";
      btn.textContent = text;
      btn.addEventListener("click", async () => {
        await flipSummon(slotIdx, position);
      });
      menu.appendChild(btn);
    });

    positionContextMenu(menu, anchorEl);
  }

  function isNormalSummonAction(action) {
    return action === "normal-summon" || action === "normal-summon-atk" || action === "normal-summon-def";
  }

  function actionSummonPosition(action) {
    return action === "normal-summon-def" || action === "special-summon-def" || action === "set-monster"
      ? "defense"
      : "attack";
  }

  function canSetMonsterFaceDown(card) {
    return isMonsterCard(card) && cardLevel(card) <= 4;
  }

  function summonKindForAction(action) {
    if (action === "set-monster") return "set";
    if (isNormalSummonAction(action)) return "normal";
    if (action === "special-summon-atk" || action === "special-summon-def") return "special";
    return "";
  }

  function shouldTriggerSummonTraps(action) {
    return isNormalSummonAction(action) || action === "special-summon-atk" || action === "special-summon-def";
  }

  async function resolveSummonTrapResponses(summonerOwner, slotIdx, summonedCard, summonKind) {
    if (!summonedCard || summonKind === "set") return {};
    const event = {
      type: "summon",
      summonerOwner,
      summonedIdx: slotIdx,
      summonedCard,
      summonKind
    };
    const trapResult = await triggerTrapResponses(event);
    if (state.defeatedOwner || ownerMonsterField(summonerOwner)[slotIdx] !== summonedCard) return trapResult;
    await triggerEffectMonsterResponses(event);
    return trapResult;
  }

  async function playToSlot(fieldArr, slotIdx, isMonsterZone) {
    if (state.activePlayer !== "player") return;
    if (state.phase !== "main1" && state.phase !== "main2") {
      showStatus("You can only play cards during a Main Phase"); return;
    }
    if (state.selectedHandIdx === null || !state.pendingAction) return;
    if (fieldArr[slotIdx] !== null) {
      showStatus("That slot is already occupied"); return;
    }

    const card = state.playerHand[state.selectedHandIdx];
    const t = cardTypeName(card);
    const action = state.pendingAction;

    if (isMonsterZone && t !== "monster") {
      showStatus("Monsters only go in the Monster Zone"); return;
    }
    if (!isMonsterZone && t === "monster") {
      showStatus("Spell / Trap cards go in the Spell / Trap Zone"); return;
    }
    if (isMonsterZone && (isNormalSummonAction(action) || action === "set-monster") && state.hasNormalSummoned) {
      showStatus("You can only Normal Summon or Set once per turn"); return;
    }
    if (isMonsterZone && action === "set-monster" && !canSetMonsterFaceDown(card)) {
      showStatus("Level 5 or higher monsters cannot be Set face-down.");
      return;
    }

    const faceDown = action === "set-monster" || action === "set-spell" || action === "set-trap";
    const position = actionSummonPosition(action);
    const handCardEl = playerHandEl?.querySelectorAll(".bf-hand-card")[state.selectedHandIdx];
    const fromRect = readRect(handCardEl);

    const playedCard = { ...card, _faceDown: faceDown, _position: position };
    if (faceDown) playedCard._setTurn = state.turn;
    fieldArr[slotIdx] = playedCard;
    state.playerHand.splice(state.selectedHandIdx, 1);
    state.selectedHandIdx = null;
    state.pendingAction = null;
    if (isMonsterZone && (isNormalSummonAction(action) || action === "set-monster")) state.hasNormalSummoned = true;

    clearSlotHighlights();
    renderField();
    renderPlayerHand();
    const zoneSlots = isMonsterZone ? monsterSlots("player") : Array.from(playerSTZone.querySelectorAll(".bf-slot"));
    if (isMonsterZone) {
      playSfx(action === "set-monster" ? "monsterSet" : "monsterSummon");
    } else if (action === "set-spell" || action === "set-trap") {
      playSfx("spellTrapSet");
    }
    await animatePlaceCard(playedCard, fromRect, zoneSlots[slotIdx], faceDown);

    if (isMonsterZone && shouldTriggerSummonTraps(action)) {
      await resolveSummonTrapResponses("player", slotIdx, playedCard, summonKindForAction(action));
    }
  }

  // ── Attach slot click listeners ─────────────────────────
  function attachSlotListeners() {
    // Player monster slots
    Array.from(playerMonZone.querySelectorAll(".bf-slot")).forEach((slot, i) => {
      slot.addEventListener("click", async () => {
        if (cardClickWasHeld()) return;
        if (handleFieldSelectionTarget("player", "monster", i)) return;
        if (await completeSpellSpecialSummon(i)) return;
        if (await completeSpellRevive(i)) return;
        if (await handleSpellFieldTarget("player", "monster", i)) return;

        // Tribute selection mode
        if (state.tributesPending > 0 && state.playerMonster[i] !== null &&
            !state.tributesSelected.includes(i)) {
          state.tributesSelected.push(i);
          slot.classList.remove("is-tribute");
          slot.classList.add("is-tribute-selected");
          if (state.tributesSelected.length >= state.tributesPending) {
            completeTribute();
          } else {
            const remaining = state.tributesPending - state.tributesSelected.length;
            showStatus(`Select ${remaining} more monster${remaining > 1 ? "s" : ""} to tribute`);
            highlightTributeTargets();
          }
          return;
        }
        if (isCompactInteractionMode() && state.playerMonster[i] && !state.pendingAction) {
          openPlayerMonsterMenu(i, slot);
          return;
        }
        if (state.phase === "battle" && state.activePlayer === "player") {
          attackWithMonster(i);
        } else {
          await playToSlot(state.playerMonster, i, true);
        }
      });
      slot.addEventListener("contextmenu", (event) => {
        event.preventDefault();
        if (isCompactInteractionMode() || cardClickWasHeld()) return;
        if (!state.pendingAction && state.playerMonster[i]) openPlayerMonsterMenu(i, slot);
      });
    });

    // Player spell/trap slots
    Array.from(playerSTZone.querySelectorAll(".bf-slot")).forEach((slot, i) => {
      slot.addEventListener("click", async () => {
        if (cardClickWasHeld()) return;
        if (handleFieldSelectionTarget("player", "spelltrap", i)) return;
        if (await handleSpellFieldTarget("player", "spelltrap", i)) return;
        const fieldCard = state.playerSpellTrap[i];
        if (isCompactInteractionMode() && !state.pendingAction && fieldCard) {
          openFieldSpellTrapMenu(i, slot);
          return;
        }
        if (!state.pendingAction && fieldCard && cardTypeName(fieldCard) === "spell" && isPlayerMainPhase()) {
          await activateSpellFromField(i);
          return;
        }
        await playToSlot(state.playerSpellTrap, i, false);
      });
      slot.addEventListener("contextmenu", (event) => {
        event.preventDefault();
        if (isCompactInteractionMode() || cardClickWasHeld()) return;
        openFieldSpellTrapMenu(i, slot);
      });
    });

    Array.from(aiMonZone.querySelectorAll(".bf-slot")).forEach((slot, i) => {
      slot.addEventListener("click", async () => {
        if (cardClickWasHeld()) return;
        if (handleFieldSelectionTarget("ai", "monster", i)) return;
        if (await handleSpellFieldTarget("ai", "monster", i)) return;
        attackSelectedTarget(i);
      });
    });

    Array.from(aiSTZone.querySelectorAll(".bf-slot")).forEach((slot, i) => {
      slot.addEventListener("click", async () => {
        if (cardClickWasHeld()) return;
        if (handleFieldSelectionTarget("ai", "spelltrap", i)) return;
        await handleSpellFieldTarget("ai", "spelltrap", i);
      });
    });
  }

  // ── Player attacks ──────────────────────────────────────
  function attackWithMonsterLegacy(slotIdx) {
    const attacker = state.playerMonster[slotIdx];
    if (!attacker) { showStatus("No monster in that slot"); return; }
    if (attacker._position === "defense") { showStatus("Monsters in defense position cannot attack"); return; }
    if (hasMonsterFinishedAttacking("player", slotIdx)) { showStatus("That monster already attacked this turn"); return; }

    const atkSlotEl = playerMonZone.querySelectorAll(".bf-slot")[slotIdx];
    atkSlotEl?.classList.add("is-attacking");
    setTimeout(() => atkSlotEl?.classList.remove("is-attacking"), 960);

    const atk = cardAtk(attacker);
    const targetIdx = state.aiMonster.findIndex((m) => m !== null);

    if (targetIdx >= 0) {
      const defender = state.aiMonster[targetIdx];

      // Flip face-down card — reveal it in defense position first
      if (defender._faceDown) {
        defender._faceDown = false;
        if (!defender._position) defender._position = "defense";
        defender._justFlipped = true;
        renderField();
      }

      const inDefense = defender._position === "defense";

      if (inDefense) {
        // ATK vs DEF
        const def = cardDef(defender);
        if (atk > def) {
          state.aiGY.push(state.aiMonster[targetIdx]);
          state.aiMonster[targetIdx] = null;
          showStatus(`${cardNameStr(attacker)} destroys ${cardNameStr(defender)}! (No damage in defense mode)`);
        } else if (atk === def) {
          showStatus("Attack equals defense — no cards destroyed, no damage!");
        } else {
          const dmg = def - atk;
          state.playerLP = Math.max(0, state.playerLP - dmg);
          updateLP();
          damageFlash($(".bf-player-lp-bar"));
          showStatus(`${cardNameStr(attacker)} can't break through! You take ${dmg} damage!`);
        }
      } else {
        // ATK vs ATK
        const defAtk = cardAtk(defender);
        if (atk > defAtk) {
          const dmg = atk - defAtk;
          state.aiLP = Math.max(0, state.aiLP - dmg);
          state.aiGY.push(state.aiMonster[targetIdx]);
          state.aiMonster[targetIdx] = null;
          updateLP();
          damageFlash($(".bf-ai-lp-bar"));
          showStatus(`${cardNameStr(attacker)} destroys ${cardNameStr(defender)}! AI takes ${dmg} damage!`);
        } else if (atk < defAtk) {
          const dmg = defAtk - atk;
          state.playerLP = Math.max(0, state.playerLP - dmg);
          state.playerGY.push(state.playerMonster[slotIdx]);
          state.playerMonster[slotIdx] = null;
          updateLP();
          damageFlash($(".bf-player-lp-bar"));
          showStatus(`${cardNameStr(attacker)} is destroyed! You take ${dmg} damage!`);
        } else {
          state.aiGY.push(state.aiMonster[targetIdx]);
          state.playerGY.push(state.playerMonster[slotIdx]);
          state.aiMonster[targetIdx] = null;
          state.playerMonster[slotIdx] = null;
          showStatus("Both monsters are destroyed! No damage.");
        }
      }
    } else {
      // Direct attack
      state.aiLP = Math.max(0, state.aiLP - atk);
      updateLP();
      damageFlash($(".bf-ai-lp-bar"));
      showStatus(`${cardNameStr(attacker)} attacks directly for ${atk} damage!`);
    }

    markMonsterAttacked("player", slotIdx);
    renderField();
    updateCounts();

    if (state.aiLP <= 0) endGame("You Win! 🏆");
  }

  function monsterSlots(owner) {
    return Array.from((owner === "player" ? playerMonZone : aiMonZone).querySelectorAll(".bf-slot"));
  }

  function directAttackTarget(attackerOwner) {
    return attackerOwner === "player" ? aiHandEl : playerHandEl;
  }

  function pulseBattleClass(elements, className, duration = BATTLE_QUAKE_MS) {
    const targets = elements.filter(Boolean);
    if (!targets.length) return Promise.resolve();

    targets.forEach((el) => el.classList.remove(className));
    targets.forEach((el) => void el.offsetWidth);
    targets.forEach((el) => el.classList.add(className));
    setTimeout(() => {
      targets.forEach((el) => el.classList.remove(className));
    }, duration);
    return sleep(duration);
  }

  function quakeMonsterSlot(owner, slotIdx) {
    return pulseBattleClass([monsterSlots(owner)[slotIdx]], "is-card-quaking");
  }

  function ownerFieldElements(owner) {
    return owner === "player"
      ? [playerHandEl, playerSTZone, playerMonZone]
      : [aiHandEl, aiSTZone, aiMonZone];
  }

  function quakeOwnerField(owner) {
    return pulseBattleClass(ownerFieldElements(owner), "is-field-quaking");
  }

  function showAttackArrow(fromSlot, toSlot) {
    if (!fromSlot || !toSlot) return Promise.resolve();
    const fromRect = fromSlot.getBoundingClientRect();
    const toRect = toSlot.getBoundingClientRect();
    const fromX = fromRect.left + fromRect.width / 2;
    const fromY = fromRect.top + fromRect.height / 2;
    const toX = toRect.left + toRect.width / 2;
    const toY = toRect.top + toRect.height / 2;
    const dx = toX - fromX;
    const dy = toY - fromY;
    const length = Math.hypot(dx, dy);
    const angle = Math.atan2(dy, dx) * 180 / Math.PI;

    const arrow = document.createElement("div");
    arrow.className = "bf-attack-arrow";
    arrow.style.left = `${fromX}px`;
    arrow.style.top = `${fromY}px`;
    arrow.style.width = `${length}px`;
    arrow.style.transform = `rotate(${angle}deg)`;
    document.body.appendChild(arrow);

    fromSlot.classList.add("is-attacking");
    if (toSlot.classList.contains("bf-slot")) toSlot.classList.add("is-attack-target");
    setTimeout(() => {
      arrow.remove();
      fromSlot.classList.remove("is-attacking");
      toSlot.classList.remove("is-attack-target");
    }, ATTACK_ARROW_MS);

    return sleep(ATTACK_ARROW_MS);
  }

  function animateTrapShieldBlock(event) {
    const fx = document.createElement("div");
    fx.className = "bf-trap-block-fx";

    const gif = document.createElement("img");
    gif.className = "bf-trap-block-gif";
    gif.src = `${BLOCK_ATTACK_GIF_SRC}?v=${Date.now()}`;
    gif.alt = "";
    gif.decoding = "async";
    gif.loading = "eager";
    gif.draggable = false;
    fx.appendChild(gif);
    document.body.appendChild(fx);

    setTimeout(() => fx.remove(), TRAP_BLOCK_MS);
    return sleep(TRAP_BLOCK_MS);
  }

  function controllerName(owner) {
    return owner === "player" ? "You" : "AI";
  }

  function lifeBar(owner) {
    return owner === "player" ? $(".bf-player-lp-bar") : $(".bf-ai-lp-bar");
  }

  function ownerSideRect(owner) {
    const elements = owner === "player"
      ? [playerMonZone, playerSTZone, playerHandEl]
      : [aiHandEl, aiSTZone, aiMonZone];
    const rects = elements.map(readRect).filter(Boolean);
    if (!rects.length) return readRect(lifeBar(owner));

    const left = Math.min(...rects.map((rect) => rect.left));
    const top = Math.min(...rects.map((rect) => rect.top));
    const right = Math.max(...rects.map((rect) => rect.left + rect.width));
    const bottom = Math.max(...rects.map((rect) => rect.top + rect.height));
    return { left, top, width: right - left, height: bottom - top };
  }

  function animateSpellDamage(owner) {
    const rect = ownerSideRect(owner);
    if (!rect) return Promise.resolve();

    const wash = document.createElement("div");
    wash.className = "bf-spell-damage-wash";
    wash.style.left = `${rect.left}px`;
    wash.style.top = `${rect.top}px`;
    wash.style.width = `${rect.width}px`;
    wash.style.height = `${rect.height}px`;
    document.body.appendChild(wash);
    setTimeout(() => wash.remove(), SPELL_LP_ANIM_MS);
    return sleep(SPELL_LP_ANIM_MS);
  }

  function animateSpellHeal(owner) {
    const rect = ownerSideRect(owner);
    if (!rect) return Promise.resolve();

    const positions = [
      [0.18, 0.76], [0.34, 0.58], [0.48, 0.72], [0.62, 0.54],
      [0.76, 0.70], [0.27, 0.42], [0.68, 0.36], [0.50, 0.46]
    ];

    positions.forEach(([x, y], index) => {
      const cross = document.createElement("div");
      cross.className = "bf-spell-heal-cross";
      cross.textContent = "+";
      cross.style.left = `${rect.left + rect.width * x}px`;
      cross.style.top = `${rect.top + rect.height * y}px`;
      cross.style.setProperty("--heal-delay", `${index * 28}ms`);
      cross.style.setProperty("--heal-drift", `${(index % 3 - 1) * 18}px`);
      document.body.appendChild(cross);
      setTimeout(() => cross.remove(), SPELL_LP_ANIM_MS + index * 28);
    });

    return sleep(SPELL_LP_ANIM_MS);
  }

  async function adjustLife(owner, amount, options = {}) {
    if (amount === 0) return Promise.resolve();
    const before = owner === "player" ? state.playerLP : state.aiLP;
    const after = Math.max(0, before - amount);
    if (owner === "player") state.playerLP = after;
    else state.aiLP = after;
    if (!state.defeatedOwner && amount > 0) {
      if (after <= 0) state.defeatedOwner = owner;
    }
    updateLP();
    const delta = after - before;
    animateLifeChange(owner, delta);
    if (delta > 0) playSfx("gainLife");
    if (delta < 0) playSfx("loseLife");
    if (delta < 0) damageFlash(lifeBar(owner));

    let animation = Promise.resolve();
    if (options.spellVisual === "damage" && delta < 0) animation = animateSpellDamage(owner);
    if (options.spellVisual === "heal" && delta > 0) animation = animateSpellHeal(owner);
    await animation;

    if (delta > 0 && !options.suppressEffectMonsterTriggers) {
      await triggerEffectMonsterResponses({
        type: "life-gain",
        owner,
        amount: delta
      });
    }
  }

  function defeatMessage(owner) {
    return owner === "player" ? "AI Wins! Better luck next time." : "You Win!";
  }

  function revealDefender(defender) {
    if (!defender?._faceDown) return false;
    defender._faceDown = false;
    if (!defender._position) defender._position = "defense";
    defender._justFlipped = true;
    return true;
  }

  async function resolveMonsterAttack(attackerOwner, attackerIdx, targetIdx = null) {
    const defenderOwner = attackerOwner === "player" ? "ai" : "player";
    const attackerField = attackerOwner === "player" ? state.playerMonster : state.aiMonster;
    const defenderField = defenderOwner === "player" ? state.playerMonster : state.aiMonster;
    const attacker = attackerField[attackerIdx];
    if (!attacker) return false;

    const attackEvent = {
      type: "attack",
      attackerOwner,
      attackerIdx,
      attackerCard: attacker,
      defenderOwner,
      targetIdx,
      defenderCard: targetIdx === null ? null : defenderField[targetIdx]
    };

    await triggerEffectMonsterResponses(attackEvent);
    if (state.defeatedOwner) return true;
    if (attackEvent.defenderDestroyedByEffectMonster) {
      if (attackerField[attackerIdx]) markMonsterAttacked(attackerOwner, attackerIdx);
      renderField();
      updateCounts();
      return Boolean(state.defeatedOwner);
    }
    if (!attackerField[attackerIdx]) {
      renderField();
      updateCounts();
      return false;
    }

    const trapResult = await triggerTrapResponses(attackEvent);
    if (trapResult.cancelAttack) {
      markMonsterAttacked(attackerOwner, attackerIdx);
      renderField();
      updateCounts();
      return Boolean(state.defeatedOwner);
    }
    if (state.defeatedOwner) return true;
    if (!attackerField[attackerIdx]) {
      renderField();
      updateCounts();
      return false;
    }

    const atk = cardAtk(attackerField[attackerIdx]);
    const defender = targetIdx === null ? null : defenderField[targetIdx];

    if (defender) {
      if (revealDefender(defender)) renderField();

      if (defender._position === "defense") {
        const def = cardDef(defender);
        if (atk > def) {
          showStatus(`${cardNameStr(attacker)} destroys ${cardNameStr(defender)}! (No damage in defense mode)`);
          await sendMonsterToGraveyard(defenderOwner, targetIdx, { shatter: true, destroyerOwner: attackerOwner, sourceCard: attacker });
        } else if (atk === def) {
          showStatus("Attack equals defense - no cards destroyed, no damage!");
        } else {
          const damage = def - atk;
          playSfx("higherDefenseAttack");
          const quakePromise = quakeMonsterSlot(attackerOwner, attackerIdx);
          const lifePromise = adjustLife(attackerOwner, damage);
          showStatus(`${cardNameStr(attacker)} can't break through! ${controllerName(attackerOwner)} take${attackerOwner === "player" ? "" : "s"} ${damage} damage!`);
          await Promise.all([quakePromise, lifePromise]);
        }
      } else {
        const defenderAtk = cardAtk(defender);
        if (atk > defenderAtk) {
          const damage = atk - defenderAtk;
          adjustLife(defenderOwner, damage);
          showStatus(`${cardNameStr(attacker)} destroys ${cardNameStr(defender)}! ${controllerName(defenderOwner)} take${defenderOwner === "player" ? "" : "s"} ${damage} damage!`);
          await sendMonsterToGraveyard(defenderOwner, targetIdx, { shatter: true, destroyerOwner: attackerOwner, sourceCard: attacker });
        } else if (atk < defenderAtk) {
          const damage = defenderAtk - atk;
          adjustLife(attackerOwner, damage);
          showStatus(`${cardNameStr(defender)} destroys ${cardNameStr(attacker)}! ${controllerName(attackerOwner)} take${attackerOwner === "player" ? "" : "s"} ${damage} damage!`);
          await sendMonsterToGraveyard(attackerOwner, attackerIdx, { shatter: true, destroyerOwner: defenderOwner, sourceCard: defender });
        } else {
          showStatus("Both monsters are destroyed! No damage.");
          await sendMonsterToGraveyard(defenderOwner, targetIdx, { shatter: true, destroyerOwner: attackerOwner, sourceCard: attacker });
          await sendMonsterToGraveyard(attackerOwner, attackerIdx, { shatter: true, destroyerOwner: defenderOwner, sourceCard: defender });
        }
      }
    } else {
      const quakePromise = quakeOwnerField(defenderOwner);
      const lifePromise = adjustLife(defenderOwner, atk);
      showStatus(`${cardNameStr(attacker)} attacks directly for ${atk} damage!`);
      await Promise.all([quakePromise, lifePromise]);
    }

    markMonsterAttacked(attackerOwner, attackerIdx);
    renderField();
    updateCounts();

    if (state.defeatedOwner) { endGame(defeatMessage(state.defeatedOwner)); return true; }
    return false;
  }

  function highlightBattleTargets(attackerIdx) {
    clearAttackHighlights();
    const playerSlots = monsterSlots("player");
    const aiSlots = monsterSlots("ai");
    playerSlots[attackerIdx]?.classList.add("is-attack-source");
    aiSlots.forEach((slot, idx) => {
      if (state.aiMonster[idx] && !isProtectedFromAttackTarget("ai", idx, "player")) slot.classList.add("is-attack-target");
    });
  }

  function openMonsterModeMenu(slotIdx, anchorEl) {
    closeHandMenu();
    const card = state.playerMonster[slotIdx];
    if (!card || card._faceDown) return;

    const blockedMessage = explainModeChangeBlocked(slotIdx);
    if (!canChangeMonsterMode("player", slotIdx)) {
      if (blockedMessage) showStatus(blockedMessage);
      return;
    }

    const menu = document.createElement("div");
    menu.className = "bf-hand-menu";
    _handMenuEl = menu;

    const label = document.createElement("div");
    label.className = "bf-hand-menu-label";
    label.textContent = "Battle Mode";
    menu.appendChild(label);

    [["Attack Position", "attack"], ["Defense Position", "defense"]].forEach(([text, position]) => {
      const btn = document.createElement("button");
      btn.className = "bf-hand-menu-item";
      btn.type = "button";
      btn.textContent = text;
      btn.disabled = card._position === position;
      if (btn.disabled) {
        btn.style.opacity = "0.35";
        btn.style.cursor = "not-allowed";
      }
      btn.addEventListener("click", async () => {
        closeHandMenu();
        changeMonsterMode("player", slotIdx, position);
      });
      menu.appendChild(btn);
    });

    positionContextMenu(menu, anchorEl);
  }

  function openPlayerMonsterMenu(slotIdx, anchorEl) {
    closeHandMenu();
    const card = state.playerMonster[slotIdx];
    if (!card) return;

    const menu = document.createElement("div");
    menu.className = "bf-hand-menu";
    _handMenuEl = menu;

    const label = document.createElement("div");
    label.className = "bf-hand-menu-label";
    label.textContent = card._faceDown ? "Face-Down Monster" : "Monster Actions";
    menu.appendChild(label);

    let actionCount = 0;
    const addItem = (text, action, options = {}) => {
      const btn = document.createElement("button");
      btn.className = "bf-hand-menu-item";
      btn.type = "button";
      btn.textContent = text;
      btn.disabled = Boolean(options.disabled);
      btn.addEventListener("click", async () => {
        closeHandMenu();
        await action();
      });
      menu.appendChild(btn);
      actionCount++;
    };

    addItem("View Details", () => openCardHoldPreview(card));

    if (card._faceDown) {
      const canFlip = canFlipSummon(slotIdx);
      addItem("Flip Summon - Attack", () => flipSummon(slotIdx, "attack"), { disabled: !canFlip });
      addItem("Flip Summon - Defense", () => flipSummon(slotIdx, "defense"), { disabled: !canFlip });
    } else {
      if (state.activePlayer === "player" && state.phase === "battle") {
        addItem("Attack", () => attackWithMonster(slotIdx), { disabled: !canPlayerMonsterAttack(slotIdx) });
      }
      if (state.activePlayer === "player" && (state.phase === "main1" || state.phase === "main2")) {
        const canChange = canChangeMonsterMode("player", slotIdx);
        addItem("Attack Position", () => changeMonsterMode("player", slotIdx, "attack"), {
          disabled: !canChange || card._position === "attack"
        });
        addItem("Defense Position", () => changeMonsterMode("player", slotIdx, "defense"), {
          disabled: !canChange || card._position === "defense"
        });
      }
    }

    if (!actionCount) return;
    positionContextMenu(menu, anchorEl);
  }

  async function attackSelectedTarget(targetIdx) {
    if (state.activePlayer !== "player" || state.phase !== "battle") return;
    if (state.resolvingBattle) return;
    if (state.selectedAttackIdx === null) {
      showStatus("Select one of your attacking monsters first");
      return;
    }
    if (!state.aiMonster[targetIdx]) {
      showStatus("Choose an occupied opposing monster slot");
      return;
    }
    if (isProtectedFromAttackTarget("ai", targetIdx, "player")) {
      showStatus(`${cardNameStr(state.aiMonster[targetIdx])} cannot be targeted by attacks right now.`);
      return;
    }

    const attackerIdx = state.selectedAttackIdx;
    clearBattleSelection();
    state.resolvingBattle = true;
    try {
      playSfx("monsterAttack");
      await showAttackArrow(monsterSlots("player")[attackerIdx], monsterSlots("ai")[targetIdx]);
      await resolveMonsterAttack("player", attackerIdx, targetIdx);
    } finally {
      state.resolvingBattle = false;
    }
  }

  async function attackWithMonster(slotIdx) {
    if (state.resolvingBattle) return;
    const attacker = state.playerMonster[slotIdx];
    if (!attacker) { showStatus("No monster in that slot"); return; }
    if (attacker._position === "defense") { showStatus("Monsters in defense position cannot attack"); return; }
    if (hasMonsterFinishedAttacking("player", slotIdx)) { showStatus("That monster already attacked this turn"); return; }

    const totalTargets = state.aiMonster.some((monster) => monster !== null);
    const hasAttackableTargets = state.aiMonster.some((monster, index) => monster && !isProtectedFromAttackTarget("ai", index, "player"));
    if (!totalTargets) {
      clearBattleSelection();
      state.resolvingBattle = true;
      try {
        playSfx("monsterDirectAttack");
        await showAttackArrow(monsterSlots("player")[slotIdx], directAttackTarget("player"));
        await resolveMonsterAttack("player", slotIdx, null);
      } finally {
        state.resolvingBattle = false;
      }
      return;
    }
    if (!hasAttackableTargets) {
      showStatus("No opposing monsters can be targeted by attacks right now.");
      return;
    }

    if (state.selectedAttackIdx === slotIdx) {
      clearBattleSelection();
      showStatus("Attack cancelled");
      return;
    }

    state.selectedAttackIdx = slotIdx;
    highlightBattleTargets(slotIdx);
    updateAttackIconAim();
    showStatus("Choose an opposing monster to attack", 2200);
  }

  function damageFlash(el) {
    if (!el) return;
    // Support both old .bf-lp-card and new .bf-lp-bar
    const target = el.closest(".bf-lp-bar") || el;
    target.classList.remove("is-damaged");
    void target.offsetWidth;
    target.classList.add("is-damaged");
    setTimeout(() => target.classList.remove("is-damaged"), 700);
  }

  // ── Card info pane ─────────────────────────────
  function showCardInfo(card) {
    if (!cardInfoEl) return;
    if (!card) {
      clearCardInfo();
      return;
    }
    cardInfoEl.classList.add("has-card");

    // Art
    if (ciArtEl) {
      ciArtEl.innerHTML = "";
      if (card.uploadedImage) {
        const img = makeArtEl(card, "bf-ci-art-inner");
        // makeArtEl wraps in a div; grab the img inside or append directly
        ciArtEl.appendChild(img);
        ciArtEl.style.background = "";
      } else {
        ciArtEl.innerHTML = "";
        ciArtEl.style.cssText = artStyle(card);
      }
    }

    const t = cardTypeName(card);
    const isMonster = t === "monster";
    if (ciNameEl) ciNameEl.textContent = cardNameStr(card);
    if (ciTypeEl) {
      const typeLabel = isMonster
        ? `${card.monsterType || "Monster"} Monster`
        : (t === "spell" ? "Spell Card" : "Trap Card");
      ciTypeEl.textContent = typeLabel;
      ciTypeEl.className = `bf-ci-type is-${t}`;
    }
    if (ciStatsEl) {
      ciStatsEl.hidden = !isMonster;
      if (isMonster) {
        if (ciLevelEl) ciLevelEl.textContent = cardLevel(card);
        if (ciAtkEl) ciAtkEl.textContent = cardAtk(card);
        if (ciDefEl) ciDefEl.textContent = cardDef(card);
      }
    }
    if (ciDescEl) {
      const desc = card.shortDescription || card.spellEffectDescription || card.trapEffectDescription
                || card.effectDescription || card.effect || "";
      ciDescEl.textContent = desc;
    }
  }

  function clearCardInfo() {
    if (!cardInfoEl) return;
    cardInfoEl.classList.remove("has-card");
    if (ciArtEl) { ciArtEl.innerHTML = ""; ciArtEl.style.cssText = ""; }
    if (ciNameEl) ciNameEl.textContent = "";
    if (ciTypeEl) ciTypeEl.textContent = "";
    if (ciStatsEl) ciStatsEl.hidden = true;
    if (ciLevelEl) ciLevelEl.textContent = "";
    if (ciAtkEl) ciAtkEl.textContent = "";
    if (ciDefEl) ciDefEl.textContent = "";
    if (ciDescEl) ciDescEl.textContent = "";
  }

  function cardTypeLabel(card) {
    const t = cardTypeName(card);
    if (t === "monster") return `${card.monsterType || "Monster"} Monster`;
    if (t === "spell") return "Spell Card";
    return "Trap Card";
  }

  function setCellText(row, text, className = "") {
    const cell = document.createElement("td");
    cell.textContent = text;
    if (className) cell.className = className;
    row.appendChild(cell);
    return cell;
  }

  function renderCardTableRows(tbody, cards, emptyText, options = {}) {
    if (!tbody) return;
    tbody.innerHTML = "";

    if (!cards.length) {
      const row = document.createElement("tr");
      const cell = document.createElement("td");
      cell.className = "bf-gy-table-empty";
      cell.colSpan = 6;
      cell.textContent = emptyText;
      row.appendChild(cell);
      tbody.appendChild(row);
      return;
    }

    const displayCards = options.reverse ? [...cards].reverse() : [...cards];
    displayCards.forEach((card, index) => {
      const t = cardTypeName(card);
      const isMonster = t === "monster";
      const row = document.createElement("tr");
      const number = options.reverse ? cards.length - index : index + 1;
      setCellText(row, String(number));
      setCellText(row, cardNameStr(card), "bf-gy-table-card");
      setCellText(row, cardTypeLabel(card), `bf-gy-table-type is-${t}`);
      setCellText(row, isMonster ? String(cardLevel(card)) : "-");
      setCellText(row, isMonster ? String(cardAtk(card)) : "-");
      setCellText(row, isMonster ? String(cardDef(card)) : "-");
      tbody.appendChild(row);
    });
  }

  function renderGraveyardTable(cards) {
    if (!gyTableBodyEl) return;
    renderCardTableRows(gyTableBodyEl, cards, "No cards in this graveyard.", { reverse: true });
  }

  function createDeckViewCard(card, index) {
    const t = cardTypeName(card);
    const isMonster = t === "monster";
    const btn = document.createElement("button");
    btn.className = `bf-deck-view-card is-${t}`;
    btn.type = "button";
    btn.setAttribute("aria-label", `${index + 1}. ${cardNameStr(card)}`);

    const number = document.createElement("div");
    number.className = "bf-deck-view-number";
    number.textContent = String(index + 1);

    const art = makeArtEl(card, "bf-deck-view-art");

    const body = document.createElement("div");
    body.className = "bf-deck-view-body";

    const name = document.createElement("div");
    name.className = "bf-deck-view-name";
    name.textContent = cardNameStr(card);

    const type = document.createElement("div");
    type.className = `bf-deck-view-type is-${t}`;
    type.textContent = cardTypeLabel(card);

    body.append(name, type);

    if (isMonster) {
      const stats = document.createElement("div");
      stats.className = "bf-deck-view-stats";
      stats.innerHTML = `<span>LV ${cardLevel(card)}</span><span>ATK ${cardAtk(card)}</span><span>DEF ${cardDef(card)}</span>`;
      body.appendChild(stats);
    }

    const desc = document.createElement("div");
    desc.className = "bf-deck-view-desc";
    desc.textContent = card.shortDescription || card.spellEffectDescription || card.trapEffectDescription
      || card.effectDescription || card.effect || "";
    body.appendChild(desc);

    btn.append(number, art, body);
    btn.addEventListener("mouseenter", () => showCardInfo(card));
    btn.addEventListener("mouseleave", clearCardInfo);
    btn.addEventListener("focus", () => showCardInfo(card));
    btn.addEventListener("blur", clearCardInfo);
    return btn;
  }

  function openDeckDialog(owner = "player") {
    closeDeckDialog();
    const cards = [...ownerDeck(owner)];
    const isPlayer = owner === "player";

    const dialog = document.createElement("div");
    dialog.className = "bf-gy-dialog bf-deck-dialog";
    dialog.setAttribute("role", "dialog");
    dialog.setAttribute("aria-modal", "true");
    dialog.setAttribute("aria-label", isPlayer ? "Your Deck" : "Opponent Deck");

    const panel = document.createElement("div");
    panel.className = "bf-gy-dialog-panel";

    const head = document.createElement("div");
    head.className = "bf-gy-dialog-head";

    const titleWrap = document.createElement("div");
    const kicker = document.createElement("span");
    kicker.className = "bf-gy-dialog-kicker";
    kicker.textContent = `${cards.length} card${cards.length === 1 ? "" : "s"} in deck`;

    const title = document.createElement("h2");
    title.className = "bf-gy-dialog-title";
    title.textContent = isPlayer ? "Your Deck" : "Opponent Deck";
    titleWrap.append(kicker, title);

    const closeBtn = document.createElement("button");
    closeBtn.className = "bf-gy-dialog-close";
    closeBtn.type = "button";
    closeBtn.textContent = "X";
    closeBtn.addEventListener("click", closeDeckDialog);

    head.append(titleWrap, closeBtn);

    const wrap = document.createElement("div");
    wrap.className = "bf-deck-view-wrap";

    if (!cards.length) {
      const empty = document.createElement("div");
      empty.className = "bf-deck-view-empty";
      empty.textContent = "No cards remain in this deck.";
      wrap.appendChild(empty);
    } else {
      cards.forEach((card, index) => {
        wrap.appendChild(createDeckViewCard(card, index));
      });
    }

    panel.append(head, wrap);
    dialog.appendChild(panel);
    dialog.addEventListener("click", (event) => {
      if (event.target === dialog) closeDeckDialog();
    });
    document.body.appendChild(dialog);
    _deckDialogEl = dialog;
    closeBtn.focus();
  }

  function openGraveyardDialog(owner) {
    if (!gyDialogEl) return;
    const isPlayer = owner === "player";
    const cards = isPlayer ? state.playerGY : state.aiGY;
    const title = isPlayer ? "Your Graveyard" : "AI Graveyard";
    if (gyOwnerEl) gyOwnerEl.textContent = `${cards.length} card${cards.length === 1 ? "" : "s"}`;
    if (gyTitleEl) gyTitleEl.textContent = title;
    renderGraveyardTable(cards);
    playSfx("openGraveyard");
    gyDialogEl.hidden = false;
    gyCloseBtn?.focus();
  }

  function closeGraveyardDialog() {
    if (gyDialogEl) gyDialogEl.hidden = true;
  }

  function clearAttackHighlights() {
    document.querySelectorAll(".bf-slot.is-attack-source, .bf-slot.is-attack-target").forEach((slot) => {
      slot.classList.remove("is-attack-source", "is-attack-target");
    });
  }

  function clearBattleSelection() {
    state.selectedAttackIdx = null;
    clearAttackHighlights();
    updateAttackIconAim();
  }

  // ── Slot highlights ─────────────────────────────
  function clearSlotHighlights() {
    document.querySelectorAll(".bf-slot.is-target").forEach(el => el.classList.remove("is-target"));
    document.querySelectorAll(".bf-slot.is-tribute").forEach(el => el.classList.remove("is-tribute"));
    document.querySelectorAll(".bf-slot.is-tribute-selected").forEach(el => el.classList.remove("is-tribute-selected"));
    clearSpellHighlights();
    clearBattleSelection();
  }

  function highlightTributeTargets() {
    document.querySelectorAll(".bf-slot.is-tribute").forEach(el => el.classList.remove("is-tribute"));
    Array.from(playerMonZone.querySelectorAll(".bf-slot")).forEach((slot, i) => {
      if (state.playerMonster[i] !== null && !state.tributesSelected.includes(i)) {
        slot.classList.add("is-tribute");
      }
    });
  }

  function highlightAvailableSlots(card, zone) {
    clearSlotHighlights();
    if (!card) return;
    const useMonster = zone === "monster" || (!zone && cardTypeName(card) === "monster");
    if (useMonster) {
      Array.from(playerMonZone.querySelectorAll(".bf-slot")).forEach((slot, i) => {
        if (state.playerMonster[i] === null) slot.classList.add("is-target");
      });
    } else {
      Array.from(playerSTZone.querySelectorAll(".bf-slot")).forEach((slot, i) => {
        if (state.playerSpellTrap[i] === null) slot.classList.add("is-target");
      });
    }
  }

  function clearSpellHighlights() {
    document.querySelectorAll(".is-spell-target, .is-spell-selected").forEach((el) => {
      el.classList.remove("is-spell-target", "is-spell-selected");
    });
  }

  function spellEffectName(card) {
    return String(card?.spellEffect || "").trim();
  }

  async function spellActivationContextFromHand(handIdx) {
    const handCardEl = playerHandEl?.querySelectorAll(".bf-hand-card")[handIdx];
    const sourceRect = readRect(handCardEl);
    const slotIdx = state.playerSpellTrap.indexOf(null);
    if (slotIdx < 0) {
      showStatus("No empty Spell / Trap Zone slot is available to activate that spell.");
      return null;
    }

    const [card] = state.playerHand.splice(handIdx, 1);
    const activatedCard = { ...card, _faceDown: false };
    state.playerSpellTrap[slotIdx] = activatedCard;
    state.selectedHandIdx = null;
    state.pendingAction = null;
    clearSlotHighlights();
    clearCardInfo();
    renderPlayerHand();
    renderField();
    updateCounts();

    const slot = spellTrapSlots("player")[slotIdx];
    await animatePlaceCard(activatedCard, sourceRect, slot, false);
    return { card: activatedCard, sourceRect: readRect(slot) || sourceRect, source: "field", owner: "player", zone: "spelltrap", slotIdx, fromHand: true };
  }

  function spellActivationContextFromField(slotIdx) {
    const slot = spellTrapSlots("player")[slotIdx];
    const sourceRect = readRect(slot);
    const card = state.playerSpellTrap[slotIdx];
    if (card) {
      card._faceDown = false;
      card._justFlipped = true;
    }
    clearSlotHighlights();
    clearCardInfo();
    renderField();
    updateCounts();
    return { card, sourceRect, source: "field", owner: "player", zone: "spelltrap", slotIdx };
  }

  async function finishSpellActivation(context, message = "", options = {}) {
    state.pendingSpell = null;
    clearSpellHighlights();
    closeSpellResolveButton();
    closeChoiceDialog();
    renderPlayerHand();
    renderField();
    if (message) showStatus(message, 1800);
    try {
      if (options.effectPromise) {
        await options.effectPromise;
      } else {
        await sleep(options.settleMs ?? SPELL_EFFECT_SETTLE_MS);
      }
      if (!options.skipGraveyard) {
        await sendActivatedSpellToGraveyard(context);
      }
      if (state.defeatedOwner) endGame(defeatMessage(state.defeatedOwner));
    } finally {
      state.resolvingSpell = false;
    }
  }

  function availableFieldTargets(owner, zones = ["monster", "spelltrap"], options = {}) {
    const entries = [];
    zones.forEach((zone) => {
      fieldForZone(owner, zone).forEach((card, index) => {
        if (!card) return;
        if (options.sourceOwner && isProtectedFromEffectTarget(owner, zone, index, options.sourceOwner)) return;
        entries.push({ owner, zone, index, card });
      });
    });
    return entries;
  }

  function highlightSpellTargets(entries) {
    clearSpellHighlights();
    entries.forEach(({ owner, zone, index }) => {
      slotsForZone(owner, zone)[index]?.classList.add("is-spell-target");
    });
  }

  function targetKey(target) {
    return `${target.owner}:${target.zone}:${target.index}`;
  }

  function currentFieldSelectionTargets(selection = state.pendingFieldSelection) {
    if (!selection) return [];
    return (selection.selected || [])
      .map((key) => selection.entries.find((entry) => targetKey(entry) === key))
      .filter((entry) => entry && fieldForZone(entry.owner, entry.zone)[entry.index] === entry.card);
  }

  function closeFieldSelection(targets = []) {
    const selection = state.pendingFieldSelection;
    if (!selection) return;

    state.pendingFieldSelection = null;
    clearSpellHighlights();
    closeSpellResolveButton();
    if (selection.onKeydown) document.removeEventListener("keydown", selection.onKeydown);
    selection.resolve(targets);
  }

  function fieldSelectionStatus(selection) {
    const max = selection.maxCount;
    const selected = selection.selected.length;
    const targetLabel = selection.targetLabel || "card";
    const actionLabel = selection.actionLabel || "Resolve";
    const remaining = Math.max(0, max - selected);
    if (selected > 0 && selection.allowPartial && selected >= selection.minCount && remaining > 0) {
      showSpellResolveButton(`${actionLabel} ${selected} selected`, () => closeFieldSelection(currentFieldSelectionTargets(selection)));
      showStatus(`Select ${remaining} more highlighted ${targetLabel}${remaining === 1 ? "" : "s"}, or ${actionLabel.toLowerCase()} selected.`);
      return;
    }
    if (remaining > 0) {
      showStatus(`Select ${remaining} highlighted ${targetLabel}${remaining === 1 ? "" : "s"} to destroy.`);
    }
  }

  async function chooseFieldTargetsByClick(owner, entries, maxCount, options = {}) {
    const limit = Math.min(maxCount, entries.length);
    if (limit <= 0) return [];

    if (owner !== "player") {
      return [...entries]
        .sort((a, b) => Math.max(cardAtk(b.card), cardDef(b.card)) - Math.max(cardAtk(a.card), cardDef(a.card)))
        .slice(0, limit);
    }

    closeChoiceDialog();
    closeFieldSelection();

    return new Promise((resolve) => {
      const selection = {
        entries: [...entries],
        selected: [],
        maxCount: limit,
        minCount: Math.min(options.minCount ?? 1, limit),
        allowPartial: options.allowPartial ?? limit > 1,
        targetLabel: options.targetLabel || "card",
        actionLabel: options.actionLabel || "Resolve",
        resolve,
        onKeydown: null
      };
      selection.onKeydown = (event) => {
        if (event.key !== "Escape") return;
        const targets = selection.selected.length >= selection.minCount ? currentFieldSelectionTargets(selection) : [];
        closeFieldSelection(targets);
      };
      state.pendingFieldSelection = selection;
      document.addEventListener("keydown", selection.onKeydown);
      highlightSpellTargets(entries);
      showStatus(options.message || `Select highlighted ${selection.targetLabel}${limit === 1 ? "" : "s"} to destroy.`);
    });
  }

  async function chooseOneFieldTargetByClick(owner, entries, options = {}) {
    const selected = await chooseFieldTargetsByClick(owner, entries, 1, {
      ...options,
      allowPartial: false
    });
    return selected[0] || null;
  }

  function handleFieldSelectionTarget(owner, zone, index) {
    const selection = state.pendingFieldSelection;
    if (!selection) return false;

    const entry = selection.entries.find((target) => (
      target.owner === owner && target.zone === zone && target.index === index &&
      fieldForZone(owner, zone)[index] === target.card
    ));
    if (!entry) {
      showStatus("That card is not a valid target.");
      return true;
    }

    const key = targetKey(entry);
    const selectedIndex = selection.selected.indexOf(key);
    if (selectedIndex >= 0) {
      selection.selected.splice(selectedIndex, 1);
      slotsForZone(owner, zone)[index]?.classList.remove("is-spell-selected");
      closeSpellResolveButton();
      fieldSelectionStatus(selection);
      return true;
    }

    selection.selected.push(key);
    slotsForZone(owner, zone)[index]?.classList.add("is-spell-selected");
    if (selection.selected.length >= selection.maxCount) {
      closeFieldSelection(currentFieldSelectionTargets(selection));
    } else {
      fieldSelectionStatus(selection);
    }
    return true;
  }

  function pendingSpellTargetEntries() {
    const pending = state.pendingSpell;
    if (!pending) return [];

    if (pending.kind === "destroy-opponent-cards") {
      return availableFieldTargets("ai", ["monster", "spelltrap"], { sourceOwner: pending.context?.owner || "player" });
    }
    if (pending.kind === "increase-stat") {
      return availableFieldTargets("player", ["monster"]);
    }
    if (pending.kind === "restrict-monster") {
      return availableFieldTargets("ai", ["monster"], { sourceOwner: pending.context?.owner || "player" });
    }
    return [];
  }

  function beginSpellTargetSelection(context, kind, entries, options = {}) {
    closeSpellResolveButton();
    state.pendingSpell = {
      context,
      kind,
      count: options.count || 1,
      selected: [],
      statType: options.statType || "",
      amount: options.amount || 0,
      turns: options.turns || 1
    };
    highlightSpellTargets(entries);
    showStatus(options.message || "Select a target for the spell.", 2500);
  }

  async function resolveSelectedSpellTargets() {
    const pending = state.pendingSpell;
    if (!pending) return;

    const selected = pending.selected || [];
    if (pending.kind === "destroy-opponent-cards") {
      const targets = selected
        .map((key) => pendingSpellTargetEntries().find((entry) => targetKey(entry) === key))
        .filter(Boolean);
      const destroyed = [];
      for (const target of targets) {
        await notifyEffectTargeted(target, pending.context?.owner || "player", pending.context?.card);
        const current = fieldForZone(target.owner, target.zone)[target.index];
        if (current) destroyed.push({ owner: target.owner, zone: target.zone, card: current });
        await destroyFieldCardToGraveyard(target.owner, target.zone, target.index, {
          faceDown: target.zone === "spelltrap",
          destroyerOwner: pending.context?.owner || "player",
          sourceCard: pending.context?.card
        });
      }
      await finishSpellActivation(pending.context, `${cardNameStr(pending.context.card)} destroyed ${targets.length} opponent card${targets.length === 1 ? "" : "s"}.`);
    }
  }

  async function handleSpellFieldTarget(owner, zone, index) {
    const pending = state.pendingSpell;
    if (!pending) return false;

    const entry = pendingSpellTargetEntries().find((target) => (
      target.owner === owner && target.zone === zone && target.index === index
    ));
    if (!entry) {
      showStatus("That card is not a valid spell target.");
      return true;
    }

    if (pending.kind === "increase-stat") {
      const card = state.playerMonster[index];
      const amount = pending.amount || 0;
      markSpellStatBoost(card);
      if (pending.statType === "defense") {
        card.defensePoints = cardDef(card) + amount;
      } else {
        card.attackPoints = cardAtk(card) + amount;
      }
      card._justModeChanged = true;
      renderField();
      await finishSpellActivation(pending.context, `${cardNameStr(card)} gained ${amount} ${pending.statType === "defense" ? "DEF" : "ATK"}.`);
      return true;
    }

    if (pending.kind === "restrict-monster") {
      const card = state.aiMonster[index];
      await notifyEffectTargeted(entry, pending.context?.owner || "player", pending.context?.card);
      card._attackRestrictedUntilTurn = Math.max(Number(card._attackRestrictedUntilTurn || 0), state.turn + pending.turns - 1);
      renderField();
      await finishSpellActivation(pending.context, `${cardNameStr(card)} cannot attack for ${pending.turns} turn${pending.turns === 1 ? "" : "s"}.`);
      return true;
    }

    if (pending.kind === "destroy-opponent-cards") {
      const key = targetKey(entry);
      if (!pending.selected.includes(key)) {
        pending.selected.push(key);
        slotsForZone(owner, zone)[index]?.classList.add("is-spell-selected");
      }
      const maxTargets = Math.min(pending.count, pendingSpellTargetEntries().length);
      if (pending.selected.length >= maxTargets) await resolveSelectedSpellTargets();
      else {
        showSpellResolveButton(`Destroy ${pending.selected.length} selected`, resolveSelectedSpellTargets);
        showStatus(`Select ${maxTargets - pending.selected.length} more card${maxTargets - pending.selected.length === 1 ? "" : "s"} to destroy, or resolve selected.`);
      }
      return true;
    }

    return false;
  }

  function eligibleSpellSummonHandIndexes() {
    const hasEmptySlot = state.playerMonster.some((card) => card === null);
    if (!hasEmptySlot) return [];
    return state.playerHand
      .map((card, index) => ({ card, index }))
      .filter(({ card }) => isMonsterCard(card) && cardLevel(card) >= 1 && cardLevel(card) <= 4)
      .map(({ index }) => index);
  }

  function handleSpellHandSelection(handIdx, handCardEl) {
    const pending = state.pendingSpell;
    if (!pending || pending.kind !== "special-summon-hand") return false;

    if (!pending.eligibleHandIndexes.includes(handIdx)) {
      showStatus("Select a level 1 to 4 monster for this spell.");
      return true;
    }

    pending.kind = "special-summon-slot";
    pending.handIdx = handIdx;
    pending.handRect = readRect(handCardEl);
    clearSpellHighlights();
    Array.from(playerMonZone.querySelectorAll(".bf-slot")).forEach((slot, index) => {
      if (!state.playerMonster[index]) slot.classList.add("is-spell-target");
    });
    renderPlayerHand();
    showStatus("Choose an empty Monster Zone slot to special summon it.");
    return true;
  }

  async function completeSpellSpecialSummon(slotIdx) {
    const pending = state.pendingSpell;
    if (!pending || pending.kind !== "special-summon-slot") return false;
    if (state.playerMonster[slotIdx]) {
      showStatus("Choose an empty Monster Zone slot.");
      return true;
    }

    const [monster] = state.playerHand.splice(pending.handIdx, 1);
    if (!monster) {
      await finishSpellActivation(pending.context, "The selected monster is no longer in hand.");
      return true;
    }

    const summoned = { ...monster, _faceDown: false, _position: "attack" };
    state.playerMonster[slotIdx] = summoned;
    renderPlayerHand();
    renderField();
    playSfx("monsterSummon");
    await animatePlaceCard(summoned, pending.handRect, monsterSlots("player")[slotIdx], false);
    await resolveSummonTrapResponses("player", slotIdx, summoned, "special");
    const stillSummoned = state.playerMonster[slotIdx] === summoned;
    await finishSpellActivation(
      pending.context,
      stillSummoned
        ? `${cardNameStr(summoned)} was special summoned by ${cardNameStr(pending.context.card)}.`
        : `${cardNameStr(summoned)} was answered by a trap.`
    );
    return true;
  }

  async function completeSpellRevive(slotIdx) {
    const pending = state.pendingSpell;
    if (!pending || pending.kind !== "revive-slot") return false;
    if (state.playerMonster[slotIdx]) {
      showStatus("Choose an empty Monster Zone slot.");
      return true;
    }

    let gyIndex = state.playerGY.findIndex((card) => card === pending.gyCard);
    if (gyIndex < 0 && state.playerGY[pending.gyIndex] === pending.gyCard) gyIndex = pending.gyIndex;
    if (gyIndex < 0) {
      await finishSpellActivation(pending.context, "The selected monster is no longer in your graveyard.");
      return true;
    }

    const [monster] = state.playerGY.splice(gyIndex, 1);
    resetSpellStatBoostOnRevive(monster);
    const revived = { ...monster, _faceDown: false, _position: "attack" };
    state.playerMonster[slotIdx] = revived;
    updateCounts();
    renderField();
    playSfx("monsterSummon");
    await animatePlaceCard(revived, playerGYSlot, monsterSlots("player")[slotIdx], false);
    await resolveSummonTrapResponses("player", slotIdx, revived, "special");
    const stillRevived = state.playerMonster[slotIdx] === revived;
    await finishSpellActivation(
      pending.context,
      stillRevived
        ? `${cardNameStr(revived)} was revived to the field.`
        : `${cardNameStr(revived)} was answered by a trap.`
    );
    return true;
  }

  function graveyardChoiceEntries(type) {
    return state.playerGY
      .map((card, index) => ({ card, index }))
      .filter(({ card }) => type === "all" || cardTypeName(card) === type);
  }

  async function destroyAllFieldCards(owner, zone, context, label) {
    const targets = availableFieldTargets(owner, [zone], { sourceOwner: context?.owner || "player" });
    if (!targets.length) {
      await finishSpellActivation(context, `${cardNameStr(context.card)} found no ${label} to destroy.`);
      return;
    }
    const destroyed = [];
    for (const target of targets) {
      await notifyEffectTargeted(target, context?.owner || "player", context?.card);
      const current = fieldForZone(owner, zone)[target.index];
      if (current) destroyed.push({ owner, zone, card: current });
      await destroyFieldCardToGraveyard(owner, zone, target.index, {
        faceDown: zone === "spelltrap",
        destroyerOwner: context?.owner || "player",
        sourceCard: context?.card
      });
    }
    await finishSpellActivation(context, `${cardNameStr(context.card)} destroyed all opponent ${label}.`);
  }

  async function activateSpellContext(context) {
    if (!context?.card) return;
    state.resolvingSpell = true;
    const card = context.card;
    const effect = spellEffectName(card);
    const params = spellParams(card);
    playSfx("spellTrapActivate");

    if (effect) {
      await triggerEffectMonsterResponses({
        type: "effect-activated",
        effectOwner: context.owner || "player",
        sourceOwner: context.owner || "player",
        sourceZone: context.zone || "spelltrap",
        sourceIdx: context.slotIdx,
        sourceCard: card,
        sourceType: "spell"
      }, { owner: opponentOwner(context.owner || "player") });
      await triggerEffectMonsterResponses({
        type: "spelltrap-activated",
        effectOwner: context.owner || "player",
        sourceOwner: context.owner || "player",
        sourceZone: context.zone || "spelltrap",
        sourceIdx: context.slotIdx,
        sourceCard: card,
        sourceType: "spell"
      }, { owner: opponentOwner(context.owner || "player") });
      const trapResult = await triggerTrapResponses({
        type: "effect",
        effectOwner: context.owner || "player",
        sourceOwner: context.owner || "player",
        sourceZone: context.zone || "spelltrap",
        sourceIdx: context.slotIdx,
        sourceCard: card,
        sourceWillGoToGraveyard: true
      });
      if (state.defeatedOwner) {
        state.resolvingSpell = false;
        return;
      }
      if (trapResult.negateEffect) {
        await finishSpellActivation(context, `${cardNameStr(card)} was negated by a trap.`, {
          skipGraveyard: Boolean(trapResult.destroyEffectSource)
        });
        return;
      }
    }

    switch (effect) {
      case "special-summon": {
        const eligibleHandIndexes = eligibleSpellSummonHandIndexes();
        if (!eligibleHandIndexes.length) {
          await finishSpellActivation(context, "No level 1 to 4 monsters are available to special summon.");
          return;
        }
        state.pendingSpell = { context, kind: "special-summon-hand", eligibleHandIndexes };
        renderPlayerHand();
        showStatus("Select a highlighted level 1 to 4 monster from your hand.");
        return;
      }
      case "draw": {
        const count = boundedNumber(params.drawCount, 1, 1, 5);
        let drawn = 0;
        for (let i = 0; i < count; i++) {
          if (!await drawCardVisible("player")) break;
          drawn++;
          if (i + 1 < count) await sleep(180);
        }
        await finishSpellActivation(context, `${cardNameStr(card)} drew ${drawn} card${drawn === 1 ? "" : "s"}.`, {
          settleMs: drawn ? 180 : SPELL_EFFECT_SETTLE_MS
        });
        return;
      }
      case "destroy-opponent-cards": {
        const entries = availableFieldTargets("ai", ["monster", "spelltrap"], { sourceOwner: context.owner || "player" });
        if (!entries.length) {
          await finishSpellActivation(context, "The opponent controls no cards to destroy.");
          return;
        }
        beginSpellTargetSelection(context, "destroy-opponent-cards", entries, {
          count: boundedNumber(params.destroyCount, 1, 1, 5),
          message: `Select up to ${boundedNumber(params.destroyCount, 1, 1, 5)} opponent card${boundedNumber(params.destroyCount, 1, 1, 5) === 1 ? "" : "s"} to destroy.`
        });
        return;
      }
      case "increase-stat": {
        const entries = availableFieldTargets("player", ["monster"]);
        const statType = params.statType === "defense" ? "defense" : "attack";
        const amount = statType === "defense"
          ? boundedNumber(params.defAmount, 100, 0, 9999)
          : boundedNumber(params.atkAmount, 100, 0, 9999);
        if (!entries.length) {
          await finishSpellActivation(context, "You control no monsters to strengthen.");
          return;
        }
        beginSpellTargetSelection(context, "increase-stat", entries, {
          statType,
          amount,
          message: `Select one of your monsters to gain ${amount} ${statType === "defense" ? "DEF" : "ATK"}.`
        });
        return;
      }
      case "destroy-opponent-monsters":
      case "destroy-all-monsters":
        await destroyAllFieldCards("ai", "monster", context, "monsters");
        return;
      case "destroy-all-spell-trap":
        await destroyAllFieldCards("ai", "spelltrap", context, "spell/trap cards");
        return;
      case "revive": {
        const hasEmptySlot = state.playerMonster.some((slot) => slot === null);
        const entries = graveyardChoiceEntries("monster");
        if (!hasEmptySlot || !entries.length) {
          await finishSpellActivation(context, !hasEmptySlot ? "No Monster Zone slot is available for revival." : "No monsters exist in your graveyard.");
          return;
        }
        openCardChoiceDialog("Revive a Monster", entries, (entry) => {
          state.pendingSpell = { context, kind: "revive-slot", gyIndex: entry.index, gyCard: entry.card };
          clearSpellHighlights();
          Array.from(playerMonZone.querySelectorAll(".bf-slot")).forEach((slot, index) => {
            if (!state.playerMonster[index]) slot.classList.add("is-spell-target");
          });
          showStatus("Choose an empty Monster Zone slot for the revived monster.");
        }, async () => {
          await finishSpellActivation(context, "Revival was cancelled.");
        });
        return;
      }
      case "increase-lp": {
        const amount = boundedNumber(params.lpAmount, 500, 0, 99999);
        const effectPromise = adjustLife("player", -amount, { spellVisual: "heal" });
        await finishSpellActivation(context, `You gained ${amount} life points.`, { effectPromise });
        return;
      }
      case "decrease-lp": {
        const amount = boundedNumber(params.lpAmount, 500, 0, 99999);
        const effectPromise = adjustLife("ai", amount, { spellVisual: "damage" });
        await finishSpellActivation(context, `AI lost ${amount} life points.`, { effectPromise });
        return;
      }
      case "return-graveyard": {
        const type = params.graveyardType || "monster";
        const dest = params.graveyardDest === "hand" ? "hand" : "deck";
        const entries = graveyardChoiceEntries(type);
        if (!entries.length) {
          await finishSpellActivation(context, `No ${type} cards exist in your graveyard.`);
          return;
        }
        openCardChoiceDialog(`Return a ${type} card`, entries, async (entry) => {
          const [returned] = state.playerGY.splice(entry.index, 1);
          if (dest === "hand") state.playerHand.push(returned);
          else state.playerDeck.unshift(returned);
          updateCounts();
          renderPlayerHand();
          await animateCardMove(returned, playerGYSlot, dest === "hand" ? (playerHandEl?.lastElementChild || playerHandEl) : playerDeckPile, "is-draw");
          await finishSpellActivation(context, `${cardNameStr(returned)} returned to your ${dest}.`);
        }, async () => {
          await finishSpellActivation(context, "Graveyard return was cancelled.");
        });
        return;
      }
      case "send-to-graveyard": {
        const count = Math.min(boundedNumber(params.sendCount, 1, 1, 5), state.aiHand.length);
        if (!count) {
          await finishSpellActivation(context, "AI has no cards in hand to send to the graveyard.");
          return;
        }
        await sendHandCardsToGraveyard("ai", Array.from({ length: count }, (_, index) => index));
        await finishSpellActivation(context, `AI sent ${count} card${count === 1 ? "" : "s"} from hand to the graveyard.`);
        return;
      }
      case "restrict-monster": {
        const entries = availableFieldTargets("ai", ["monster"], { sourceOwner: context.owner || "player" });
        if (!entries.length) {
          await finishSpellActivation(context, "AI controls no monsters to restrict.");
          return;
        }
        beginSpellTargetSelection(context, "restrict-monster", entries, {
          turns: boundedNumber(params.restrictTurns, 1, 1, 9),
          message: "Select an AI monster to restrict from attacking."
        });
        return;
      }
      case "restrict-opponent": {
        const turns = boundedNumber(params.restrictTurns, 1, 1, 9);
        state.aiBattleRestrictedUntilTurn = Math.max(state.aiBattleRestrictedUntilTurn, state.turn + turns - 1);
        await finishSpellActivation(context, `AI cannot enter the Battle Phase for ${turns} turn${turns === 1 ? "" : "s"}.`);
        return;
      }
      default:
        await finishSpellActivation(context, `${cardNameStr(card)} has no spell effect selected.`);
    }
  }

  async function activateSpellFromHand(handIdx) {
    if (isSpellResolutionBusy()) {
      showStatus("Finish resolving the active spell first.");
      return;
    }
    const card = state.playerHand[handIdx];
    if (!card || cardTypeName(card) !== "spell") return;
    const context = await spellActivationContextFromHand(handIdx);
    if (!context) return;
    await activateSpellContext(context);
  }

  async function activateSpellFromField(slotIdx) {
    if (isSpellResolutionBusy()) {
      showStatus("Finish resolving the active spell first.");
      return;
    }
    if (!isPlayerMainPhase()) {
      showStatus("You can activate spell cards during your Main Phase.");
      return;
    }
    const card = state.playerSpellTrap[slotIdx];
    if (!card || cardTypeName(card) !== "spell") return;
    await activateSpellContext(spellActivationContextFromField(slotIdx));
  }

  // ── Hand card context menu ───────────────────────────────
  async function activateTrapFromField(slotIdx) {
    if (isSpellResolutionBusy()) {
      showStatus("Finish resolving the active spell or trap first.");
      return;
    }
    const card = state.playerSpellTrap[slotIdx];
    if (!card || cardTypeName(card) !== "trap") return;
    if (!isTrapReady("player", slotIdx)) {
      showStatus("That trap can be activated after the turn it was Set.");
      return;
    }
    showStatus(`${cardNameStr(card)} is ready and will activate when its trigger happens.`, 2200);
  }

  async function sendFieldSpellTrapToGraveyard(slotIdx) {
    if (isSpellResolutionBusy()) {
      showStatus("Finish resolving the active spell or trap first.");
      return;
    }
    const card = state.playerSpellTrap[slotIdx];
    if (!card) return;
    await sendFieldCardToGraveyard("player", "spelltrap", slotIdx, {
      faceDown: Boolean(card._faceDown)
    });
    showStatus(`${cardNameStr(card)} was sent to the graveyard.`, 1600);
  }

  function closeHandMenu() {
    if (_handMenuEl) { _handMenuEl.remove(); _handMenuEl = null; }
  }

  function positionContextMenu(menu, anchorEl) {
    document.body.appendChild(menu);
    if (isCompactInteractionMode()) {
      menu.classList.add("is-mobile-sheet");
      menu.style.left = "";
      menu.style.top = "";
      menu.style.transform = "";
      requestAnimationFrame(() => {
        document.addEventListener("click", closeHandMenu, { once: true });
      });
      return;
    }

    const rect = anchorEl.getBoundingClientRect();
    const mw = menu.offsetWidth;
    let left = rect.left + rect.width / 2 - mw / 2;
    left = Math.max(4, Math.min(left, window.innerWidth - mw - 4));
    menu.style.left = left + "px";
    menu.style.top = rect.top + "px";
    menu.style.transform = "translateY(calc(-100% - 6px))";
    requestAnimationFrame(() => {
      document.addEventListener("click", closeHandMenu, { once: true });
    });
  }

  async function shufflePlayerDeck() {
    closeHandMenu();
    if (isSpellResolutionBusy()) {
      showStatus("Finish resolving the active effect first.");
      return;
    }
    if (state.playerDeck.length <= 1) {
      showStatus("Not enough cards in deck to shuffle.");
      return;
    }

    playerDeckPile?.classList.add("is-shuffling");
    playSfx("deckShuffle");
    await sleep(1000);
    state.playerDeck = shuffle(state.playerDeck);
    playerDeckPile?.classList.remove("is-shuffling");
    updateCounts();
    showStatus("Deck shuffled.", 1400);
  }

  function openDeckMenu(anchorEl) {
    closeHandMenu();
    if (isDuelEnded()) return;

    const menu = document.createElement("div");
    menu.className = "bf-hand-menu";
    _handMenuEl = menu;

    const label = document.createElement("div");
    label.className = "bf-hand-menu-label";
    label.textContent = "Deck Actions";
    menu.appendChild(label);

    if (state.activePlayer === "player" && state.phase === "draw" && !state.hasDrawn) {
      const drawBtn = document.createElement("button");
      drawBtn.className = "bf-hand-menu-item";
      drawBtn.type = "button";
      drawBtn.textContent = "Draw Card";
      drawBtn.addEventListener("click", async () => {
        closeHandMenu();
        await doDraw();
      });
      menu.appendChild(drawBtn);
    }

    const viewBtn = document.createElement("button");
    viewBtn.className = "bf-hand-menu-item";
    viewBtn.type = "button";
    viewBtn.textContent = "View Deck";
    viewBtn.addEventListener("click", () => {
      closeHandMenu();
      openDeckDialog("player");
    });
    menu.appendChild(viewBtn);

    const shuffleBtn = document.createElement("button");
    shuffleBtn.className = "bf-hand-menu-item";
    shuffleBtn.type = "button";
    shuffleBtn.textContent = "Shuffle";
    shuffleBtn.addEventListener("click", shufflePlayerDeck);
    menu.appendChild(shuffleBtn);

    positionContextMenu(menu, anchorEl);
  }

  function openFieldSpellTrapMenu(slotIdx, anchorEl) {
    closeHandMenu();
    if (state.activePlayer !== "player") return;
    if (isSpellResolutionBusy()) {
      showStatus("Finish resolving the active spell or trap first.");
      return;
    }
    const card = state.playerSpellTrap[slotIdx];
    if (!card) return;

    const type = cardTypeName(card);
    const menu = document.createElement("div");
    menu.className = "bf-hand-menu";
    _handMenuEl = menu;

    const label = document.createElement("div");
    label.className = "bf-hand-menu-label";
    label.textContent = type === "trap" ? "Trap Actions" : "Spell Actions";
    menu.appendChild(label);

    function item(text, onClick, cls = "") {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "bf-hand-menu-item" + (cls ? " " + cls : "");
      btn.textContent = text;
      btn.addEventListener("click", async () => {
        closeHandMenu();
        await onClick();
      });
      return btn;
    }

    menu.appendChild(item("Activate", async () => {
      if (type === "spell") {
        await activateSpellFromField(slotIdx);
      } else if (type === "trap") {
        await activateTrapFromField(slotIdx);
      }
    }));
    menu.insertBefore(item("View Details", async () => {
      openCardHoldPreview(card);
    }), menu.children[1]);
    menu.appendChild(item("Send to Graveyard", async () => {
      await sendFieldSpellTrapToGraveyard(slotIdx);
    }, "is-danger"));

    positionContextMenu(menu, anchorEl);
  }

  function openHandCardMenu(idx, anchorEl) {
    closeHandMenu();
    if (state.activePlayer !== "player") return;
    if (isSpellResolutionBusy()) { showStatus("Finish resolving the active spell first."); return; }
    const card = state.playerHand[idx];
    if (!card) return;
    const t = cardTypeName(card);
    const inMain = state.phase === "main1" || state.phase === "main2";

    const menu = document.createElement("div");
    menu.className = "bf-hand-menu";
    _handMenuEl = menu;

    function item(label, action, cls) {
      const btn = document.createElement("button");
      btn.className = "bf-hand-menu-item" + (cls ? " " + cls : "");
      btn.textContent = label;
      btn.addEventListener("click", () => { closeHandMenu(); doCardAction(action, idx); });
      return btn;
    }
    function disableMenuButton(btn) {
      btn.disabled = true;
      btn.style.opacity = "0.35";
      btn.style.cursor = "not-allowed";
    }
    function sep() { const d = document.createElement("div"); d.className = "bf-hand-menu-sep"; return d; }
    function lbl(text) { const d = document.createElement("div"); d.className = "bf-hand-menu-label"; d.textContent = text; return d; }

    menu.appendChild(lbl("Card Actions"));
    const viewDetailsBtn = document.createElement("button");
    viewDetailsBtn.className = "bf-hand-menu-item";
    viewDetailsBtn.type = "button";
    viewDetailsBtn.textContent = "View Details";
    viewDetailsBtn.addEventListener("click", () => {
      closeHandMenu();
      openCardHoldPreview(card);
    });
    menu.appendChild(viewDetailsBtn);

    if (state.phase === "draw") {
      const drawFirstBtn = document.createElement("button");
      drawFirstBtn.className = "bf-hand-menu-item";
      drawFirstBtn.type = "button";
      drawFirstBtn.textContent = "Draw a card first";
      disableMenuButton(drawFirstBtn);
      menu.appendChild(drawFirstBtn);
      positionContextMenu(menu, anchorEl);
      return;
    }

    if (inMain) {
      if (t === "monster") {
        const alreadySummoned = state.hasNormalSummoned;
        const tributesNeeded = tributeRequirement(card);
        const fieldCount = state.playerMonster.filter(m => m !== null).length;
        const canTribute = fieldCount >= tributesNeeded;
        menu.appendChild(sep());
        menu.appendChild(lbl("Monster Actions"));
        const nsSuffix = tributesNeeded > 0
          ? ` (${tributesNeeded} tribute${tributesNeeded > 1 ? "s" : ""})`
          : "";
        const nsAtkBtn = item(`Normal Summon ATK${nsSuffix}`, "normal-summon-atk");
        const nsDefBtn = item(`Normal Summon DEF${nsSuffix}`, "normal-summon-def");
        const setBtn = item("Set Face-Down", "set-monster");
        if (alreadySummoned || !canTribute) {
          [nsAtkBtn, nsDefBtn].forEach(disableMenuButton);
        }
        if (alreadySummoned || !canSetMonsterFaceDown(card)) {
          disableMenuButton(setBtn);
          if (!alreadySummoned && !canSetMonsterFaceDown(card)) {
            setBtn.title = "Level 5 or higher monsters cannot be Set face-down.";
          }
        }
        menu.appendChild(nsAtkBtn);
        menu.appendChild(nsDefBtn);
        menu.appendChild(item("Special Summon (ATK)", "special-summon-atk"));
        menu.appendChild(item("Special Summon (DEF)", "special-summon-def"));
        menu.appendChild(setBtn);
        menu.appendChild(sep());
      } else if (t === "spell") {
        menu.appendChild(sep());
        menu.appendChild(lbl("Spell Actions"));
        menu.appendChild(item("Activate", "activate-spell"));
        menu.appendChild(item("Set Face-Down", "set-spell"));
        menu.appendChild(sep());
      } else if (t === "trap") {
        menu.appendChild(sep());
        menu.appendChild(lbl("Trap Actions"));
        menu.appendChild(item("Set Face-Down", "set-trap"));
        menu.appendChild(sep());
      }
    }
    menu.appendChild(item("Send to Graveyard", "to-gy", "is-danger"));
    menu.appendChild(item("Return to Top of Deck", "to-deck-top"));

    positionContextMenu(menu, anchorEl);
  }

  function doCardAction(action, handIdx) {
    if (state.activePlayer !== "player") return;
    const card = state.playerHand[handIdx];
    if (!card) return;
    const inMain = state.phase === "main1" || state.phase === "main2";

    if (action === "to-gy") {
      const handCardEl = playerHandEl?.querySelectorAll(".bf-hand-card")[handIdx];
      const fromRect = readRect(handCardEl);
      const [sentCard] = state.playerHand.splice(handIdx, 1);
      state.playerGY.push(sentCard);
      state.selectedHandIdx = null; state.pendingAction = null;
      clearSlotHighlights(); clearCardInfo();
      renderPlayerHand(); updateCounts();
      animateCardToGraveyard(sentCard, fromRect, "player");
      return;
    }
    if (action === "to-deck-top") {
      state.playerDeck.unshift(state.playerHand.splice(handIdx, 1)[0]);
      state.selectedHandIdx = null; state.pendingAction = null;
      clearSlotHighlights(); clearCardInfo();
      renderPlayerHand(); updateCounts();
      return;
    }
    if (!inMain) { showStatus("You can only play cards during a Main Phase"); return; }
    if (action === "activate-spell") {
      activateSpellFromHand(handIdx);
      return;
    }
    if (action === "set-monster" && !canSetMonsterFaceDown(card)) {
      showStatus("Level 5 or higher monsters cannot be Set face-down.");
      return;
    }

    // Tribute check for normal summon
    if (isNormalSummonAction(action)) {
      const required = tributeRequirement(card);
      if (required > 0) {
        const available = state.playerMonster.filter(m => m !== null).length;
        if (available < required) {
          const noun = required === 1 ? "monster" : "monsters";
          showStatus(`${required} ${noun} on the field required to tribute summon — none available`);
          return;
        }
        // Enter tribute selection mode
        state.selectedHandIdx = handIdx;
        state.pendingAction = action;
        state.tributesPending = required;
        state.tributesSelected = [];
        highlightTributeTargets();
        showStatus(`Select ${required} monster${required > 1 ? "s" : ""} on your field to tribute`);
        renderPlayerHand();
        return;
      }
    }

    state.selectedHandIdx = handIdx;
    state.pendingAction = action;
    const zone = (isNormalSummonAction(action) || action === "special-summon-atk" ||
                  action === "special-summon-def" || action === "set-monster")
                 ? "monster" : "spelltrap";
    highlightAvailableSlots(card, zone);
    renderPlayerHand();
  }

  function completeTribute() {
    // Remove tributed monsters, send to GY
    const tributes = state.tributesSelected
      .map((i) => ({
        card: state.playerMonster[i],
        rect: readRect(monsterSlots("player")[i])
      }))
      .filter((entry) => entry.card);

    state.tributesSelected.forEach(i => {
      state.playerGY.push(state.playerMonster[i]);
      state.playerMonster[i] = null;
    });
    state.tributesSelected = [];
    state.tributesPending = 0;
    clearSlotHighlights();
    renderField();
    updateCounts();
    // Now highlight empty monster slots for placement
    const card = state.playerHand[state.selectedHandIdx];
    highlightAvailableSlots(card, "monster");
    showStatus("Tribute complete — choose an empty slot to summon");
    renderPlayerHand();
    tributes.forEach(({ card, rect }) => animateCardToGraveyard(card, rect, "player"));
  }

  // ── Phase button clicks ─────────────────────────────────
  const phaseOrder = ["draw", "main1", "battle", "main2", "end"];
  let turnTransitionPromptOpen = false;

  phaseButtons.forEach((btn) => {
    btn.addEventListener("click", async () => {
      if (state.activePlayer !== "player") return;
      if (turnTransitionPromptOpen) return;
      if (isSpellResolutionBusy()) {
        showStatus("Finish resolving the active spell first.");
        return;
      }
      const current = phaseOrder.indexOf(state.phase);
      const target  = phaseOrder.indexOf(btn.dataset.bfPhase);

      if (state.phase === "draw" && !state.hasDrawn && btn.dataset.bfPhase !== "draw") {
        showStatus("Draw a card before moving to another phase.");
        return;
      }

      if (target <= current) return; // can't go backwards

      // The player who starts the duel skips Battle Phase on their first turn.
      if (btn.dataset.bfPhase === "battle" && state.turn === 1 && state.activePlayer === state.startingPlayer) {
        showStatus("No Battle Phase for the first player on turn 1.");
        return;
      }

      // Handle draw phase manually if user clicks Draw Phase
      if (btn.dataset.bfPhase === "draw") return;

      turnTransitionPromptOpen = true;
      const confirmed = await promptTrapDecision(
        "Change Phase?",
        `Move from ${phaseLabel(state.phase)} Phase to ${phaseLabel(btn.dataset.bfPhase)} Phase?`,
        "Continue",
        "Stay"
      );
      turnTransitionPromptOpen = false;
      if (!confirmed || state.activePlayer !== "player") return;

      if (btn.dataset.bfPhase === "battle") {
        state.monstersAttackedThisTurn.clear();
        state.monsterAttackCountsThisTurn.clear();
      }

      setPhase(btn.dataset.bfPhase);

      if (btn.dataset.bfPhase === "battle") {
        showStatus("Battle Phase — click your monsters to attack!", 3000);
      }
      if (btn.dataset.bfPhase === "main2") {
        showStatus("Main Phase 2 — play more cards or end your turn", 2500);
        await triggerEffectMonsterResponses({ type: "hand", owner: "player" }, { owner: "player" });
      }
    });
  });

  // ── Draw via deck prompt or clicking the deck pile ──────
  async function doDraw() {
    if (state.activePlayer !== "player") return;
    if (state.phase !== "draw") return;
    if (state.hasDrawn) { showStatus("Already drew this turn!"); return; }
    if (!await drawCard("player")) return;
    state.hasDrawn = true;
    updateDrawPrompt();
    setTimeout(async () => {
      setPhase("main1");
      await triggerEffectMonsterResponses({ type: "hand", owner: "player" }, { owner: "player" });
    }, 600);
  }

  drawPromptEl?.addEventListener("click", doDraw);
  $("[data-player-deck]")?.addEventListener("click", () => {
    if (isCompactInteractionMode()) {
      openDeckMenu(playerDeckPile);
      return;
    }
    doDraw();
  });
  $("[data-player-deck]")?.addEventListener("contextmenu", (event) => {
    event.preventDefault();
    if (isCompactInteractionMode()) return;
    openDeckMenu(playerDeckPile);
  });

  function bindGraveyardSlot(slotEl, owner) {
    if (!slotEl) return;
    slotEl.addEventListener("click", () => openGraveyardDialog(owner));
    slotEl.addEventListener("keydown", (event) => {
      if (event.key !== "Enter" && event.key !== " ") return;
      event.preventDefault();
      openGraveyardDialog(owner);
    });
  }

  bindGraveyardSlot(playerGYSlot, "player");
  bindGraveyardSlot(aiGYSlot, "ai");
  gyCloseBtn?.addEventListener("click", closeGraveyardDialog);
  gyDialogEl?.addEventListener("click", (event) => {
    if (event.target === gyDialogEl) closeGraveyardDialog();
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && gyDialogEl && !gyDialogEl.hidden) closeGraveyardDialog();
    if (event.key === "Escape" && _deckDialogEl) closeDeckDialog();
    if (event.key === "Escape") closeMobileSidebar();
    if (event.key === "Escape") closeCardHoldPreview();
  });
  document.addEventListener("pointermove", updateAttackIconAim);

  // End Turn button
  endTurnBtn?.addEventListener("click", async () => {
    if (state.activePlayer !== "player") return;
    if (turnTransitionPromptOpen) return;
    turnTransitionPromptOpen = true;
    const confirmed = await promptTrapDecision(
      "End Turn?",
      "Finish your turn and pass control to your opponent?",
      "End Turn",
      "Stay"
    );
    turnTransitionPromptOpen = false;
    if (!confirmed || state.activePlayer !== "player") return;
    endPlayerTurn();
  });

  // ── Player ends turn ────────────────────────────────────
  function endPlayerTurn() {
    if (isSpellResolutionBusy()) {
      showStatus("Finish resolving the active spell first.");
      return;
    }
    state.effectMonsterUsesThisTurn.clear();
    state.monsterAttackCountsThisTurn.clear();
    state.activePlayer = "ai";
    state.hasNormalSummoned = false;
    state.battleEnteredThisTurn = false;
    clearModeChangesFor("ai");
    state.tributesPending = 0;
    state.tributesSelected = [];
    closeHandMenu();
    clearSlotHighlights();
    clearCardInfo();
    if (endTurnBtn) endTurnBtn.disabled = true;
    playSfx("endTurn");
    setPhase("end");
    showStatus("Your turn ended — AI is thinking…", 1500);
    setTimeout(doAiTurn, 1800);
  }

  // ── AI turn ──────────────────────────────────────────────
  function monsterPower(card) {
    return Math.max(cardAtk(card), cardDef(card));
  }

  function pickAiTributes(required) {
    return state.aiMonster
      .map((card, index) => ({ card, index }))
      .filter((entry) => entry.card)
      .sort((a, b) => monsterPower(a.card) - monsterPower(b.card))
      .slice(0, required)
      .map((entry) => entry.index);
  }

  function canAiNormalSummon(card) {
    if (state.hasNormalSummoned || cardTypeName(card) !== "monster") return false;
    const required = tributeRequirement(card);
    const availableTributes = state.aiMonster.filter((monster) => monster !== null).length;
    const hasEmptySlot = state.aiMonster.some((monster) => monster === null);
    return availableTributes >= required && (hasEmptySlot || required > 0);
  }

  function chooseAiSummonPosition(card) {
    return cardDef(card) > cardAtk(card) ? "defense" : "attack";
  }

  async function aiNormalSummon(handIdx) {
    const card = state.aiHand[handIdx];
    if (!card || !canAiNormalSummon(card)) return false;

    const required = tributeRequirement(card);
    const tributeIndices = pickAiTributes(required);
    if (tributeIndices.length < required) return false;

    const tributeNames = tributeIndices.map((index) => cardNameStr(state.aiMonster[index]));
    const tributes = tributeIndices.map((index) => ({
      card: state.aiMonster[index],
      rect: readRect(monsterSlots("ai")[index])
    }));
    const fromRect = readRect(aiHandEl?.querySelectorAll(".bf-ai-hand-card")[handIdx]);

    tributeIndices.forEach((index) => {
      state.aiGY.push(state.aiMonster[index]);
      state.aiMonster[index] = null;
    });
    tributes.forEach(({ card, rect }) => animateCardToGraveyard(card, rect, "ai"));

    const emptyMon = state.aiMonster.indexOf(null);
    if (emptyMon < 0) return false;

    const [summonedCard] = state.aiHand.splice(handIdx, 1);
    const position = chooseAiSummonPosition(summonedCard);
    state.aiMonster[emptyMon] = { ...summonedCard, _faceDown: false, _position: position };
    state.hasNormalSummoned = true;
    renderField();
    renderAiHand();
    updateCounts();
    playSfx("monsterSummon");
    await animatePlaceCard(state.aiMonster[emptyMon], fromRect, monsterSlots("ai")[emptyMon], false);
    const positionLabel = position === "attack" ? "Attack" : "Defense";

    if (required > 0) {
      showStatus(`AI tributes ${tributeNames.join(", ")} to summon ${cardNameStr(summonedCard)} in ${positionLabel} Position!`, 1700);
    } else {
      showStatus(`AI summons ${cardNameStr(summonedCard)} in ${positionLabel} Position!`, 1400);
    }
    await resolveSummonTrapResponses("ai", emptyMon, state.aiMonster[emptyMon] || summonedCard, "normal");
    return true;
  }

  function changeAiMonsterModes() {
    let changed = 0;
    state.aiMonster.forEach((card, index) => {
      if (!card || !canChangeMonsterMode("ai", index)) return;
      const preferred = cardDef(card) > cardAtk(card) ? "defense" : "attack";
      if (card._position === preferred) return;
      card._position = preferred;
      card._justModeChanged = true;
      state.monstersChangedModeThisTurn.add(modeChangeKey("ai", index));
      changed++;
    });

    if (changed) {
      renderField();
      showStatus(`AI changed ${changed} monster${changed > 1 ? "s" : ""} to a better battle position.`, 1300);
    }
    return changed;
  }

  function targetBattleValue(card) {
    if (card._faceDown) return AI_FACE_DOWN_DEFENSE_GUESS;
    if (card._position === "defense") return cardDef(card);
    return cardAtk(card);
  }

  function aiMonsterValue(card) {
    if (card._faceDown) return AI_FACE_DOWN_VALUE_GUESS;
    return Math.max(cardAtk(card), cardDef(card));
  }

  function evaluateAiAttackTarget(attacker, target, targetIdx) {
    const atk = cardAtk(attacker);
    const targetValue = targetBattleValue(target);
    const targetPower = aiMonsterValue(target);
    const attackerPower = aiMonsterValue(attacker);
    const targetInDefense = target._faceDown || target._position === "defense";

    if (targetInDefense) {
      if (atk > targetValue) {
        return {
          type: "monster",
          targetIdx,
          score: 1200 + targetPower + Math.floor((atk - targetValue) / 3),
          reason: "destroy-defense"
        };
      }
      return {
        type: "skip",
        targetIdx,
        score: -900 - Math.max(0, targetValue - atk),
        reason: atk < targetValue ? "defense-damage-risk" : "no-defense-gain"
      };
    }

    if (atk > targetValue) {
      const damage = atk - targetValue;
      return {
        type: "monster",
        targetIdx,
        score: 1800 + targetPower + damage,
        reason: "destroy-attack",
        damage
      };
    }

    if (atk === targetValue) {
      const tradeScore = targetPower - attackerPower;
      return {
        type: tradeScore > 250 ? "monster" : "skip",
        targetIdx,
        score: tradeScore > 250 ? 550 + tradeScore : -120,
        reason: tradeScore > 250 ? "valuable-trade" : "poor-trade"
      };
    }

    return {
      type: "skip",
      targetIdx,
      score: -1400 - (targetValue - atk),
      reason: "losing-attack"
    };
  }

  function chooseAiAttackAction(attacker, attackerIdx) {
    if (!attacker || attacker._faceDown || attacker._position === "defense") {
      return { type: "skip", reason: "cannot-attack" };
    }
    const atk = cardAtk(attacker);
    if (atk <= 0) return { type: "skip", reason: "cannot-attack" };
    if (hasMonsterFinishedAttacking("ai", attackerIdx)) return { type: "skip", reason: "already-attacked" };
    if (Number(attacker._attackRestrictedUntilTurn || 0) >= state.turn) {
      return { type: "skip", reason: "restricted" };
    }

    const targets = state.playerMonster
      .map((card, index) => ({ card, index }))
      .filter((entry) => entry.card && !isProtectedFromAttackTarget("player", entry.index, "ai"));
    if (!targets.length) {
      const hasAnyMonster = state.playerMonster.some(Boolean);
      return hasAnyMonster
        ? { type: "skip", reason: "protected-targets" }
        : { type: "direct", targetIdx: null, score: 1000 + atk, reason: "open-field" };
    }

    const choices = targets
      .map((entry) => evaluateAiAttackTarget(attacker, entry.card, entry.index))
      .sort((a, b) => b.score - a.score);
    const best = choices[0];

    if (best && best.type === "monster" && best.score > 0) return best;
    return { type: "skip", reason: "no-favorable-target", attackerIdx };
  }

  async function doAiTurn() {
    if (isDuelEnded()) return;
    // Draw Phase
    setPhase("draw");
    if (!await drawCard("ai")) return;
    if (isDuelEnded()) return;

    await sleep(1300);
    if (isDuelEnded()) return;

    // Main Phase 1 — try to play one card
    setPhase("main1");
    await triggerEffectMonsterResponses({ type: "hand", owner: "ai" }, { owner: "ai" });
    if (isDuelEnded()) return;
    let played = false;

    if (state.aiHand.length) {
      // Prefer monsters that can be legally normal summoned this turn.
      const monIdx = state.aiHand.findIndex((c) => canAiNormalSummon(c));
      const stIdx  = state.aiHand.findIndex((c) => cardTypeName(c) !== "monster");
      const emptyST  = state.aiSpellTrap.indexOf(null);

      if (monIdx >= 0) {
        played = await aiNormalSummon(monIdx);
      }
      if (!played && stIdx >= 0 && emptyST >= 0) {
        const fromRect = readRect(aiHandEl?.querySelectorAll(".bf-ai-hand-card")[stIdx]);
        const [card] = state.aiHand.splice(stIdx, 1);
        state.aiSpellTrap[emptyST] = { ...card, _faceDown: true, _setTurn: state.turn };
        requestAnimationFrame(() => {
          playSfx("spellTrapSet");
          animatePlaceCard(state.aiSpellTrap[emptyST], fromRect, Array.from(aiSTZone.querySelectorAll(".bf-slot"))[emptyST], true);
        });
        showStatus("AI sets a card face-down.", 1400);
        played = true;
      }

      if (played) {
        renderField();
        renderAiHand();
        updateCounts();
        await sleep(1600);
        if (isDuelEnded()) return;
      }
    }

    if (changeAiMonsterModes()) {
      await sleep(1100);
      if (isDuelEnded()) return;
    }

    // Battle Phase
    const aiSkipsFirstTurnBattle = state.turn === 1 && state.activePlayer === state.startingPlayer;
    if (Number(state.aiBattleRestrictedUntilTurn || 0) >= state.turn || aiSkipsFirstTurnBattle) {
      setPhase("main2");
      showStatus(aiSkipsFirstTurnBattle ? "AI skips Battle Phase on the first turn." : "AI is restricted from entering the Battle Phase.", 1600);
      await sleep(1600);
      if (isDuelEnded()) return;
    } else {
      state.monsterAttackCountsThisTurn.clear();
      setPhase("battle");
      await sleep(1200);
      if (isDuelEnded()) return;

      for (let i = 0; i < 5; i++) {
        if (isDuelEnded()) return;
        while (state.aiMonster[i] && !hasMonsterFinishedAttacking("ai", i)) {
          const attacker = state.aiMonster[i];
          if (attacker._position === "defense") break; // defense monsters don't attack

          const attackAction = chooseAiAttackAction(attacker, i);
          if (attackAction.type === "skip") {
            if (attackAction.reason === "restricted") {
              showStatus(`${cardNameStr(attacker)} is restricted from attacking.`, 1200);
              await sleep(800);
              if (isDuelEnded()) return;
            } else if (attackAction.reason === "no-favorable-target") {
              showStatus(`AI keeps ${cardNameStr(attacker)} from making a risky attack.`, 1200);
              await sleep(800);
              if (isDuelEnded()) return;
            }
            break;
          }
          const chosenTargetIdx = attackAction.type === "direct" ? null : attackAction.targetIdx;
          playSfx(attackAction.type === "direct" ? "monsterDirectAttack" : "monsterAttack");
          await showAttackArrow(
            monsterSlots("ai")[i],
            attackAction.type === "direct" ? directAttackTarget("ai") : monsterSlots("player")[chosenTargetIdx]
          );
          if (isDuelEnded()) return;
          if (await resolveMonsterAttack("ai", i, chosenTargetIdx)) return;
          await sleep(1400);
          if (isDuelEnded()) return;
        }

      }
    }

    // End Phase → start player turn
    if (isDuelEnded()) return;
    playSfx("endTurn");
    setPhase("end");
    await sleep(900);
    if (isDuelEnded()) return;

    state.turn++;
    state.activePlayer = "player";
    state.hasNormalSummoned = false;
    state.hasDrawn = false;
    state.battleEnteredThisTurn = false;
    state.monstersAttackedThisTurn.clear();
    state.monsterAttackCountsThisTurn.clear();
    state.effectMonsterUsesThisTurn.clear();
    expireTemporaryMonsterEffects();
    clearModeChangesFor("player");

    // Give control back — player clicks the deck prompt to draw
    setPhase("draw");   // updateDrawPrompt() fires inside setPhase; endTurnBtn disabled here too
  }

  // ── End game ─────────────────────────────────────────────
  function playerWonResult(msg) {
    return state.defeatedOwner === "ai" || /\byou win\b|\bvictory\b/i.test(String(msg || ""));
  }

  function stopResultMusic() {
    if (!resultMusicAudio) return;
    try {
      resultMusicAudio.pause();
      resultMusicAudio.currentTime = 0;
    } catch {
      // The browser may discard media state during navigation.
    }
    resultMusicAudio = null;
  }

  function playResultSfx(msg) {
    if (state.resultSfxPlayed) return;
    state.resultSfxPlayed = true;
    stopResultMusic();
    resultMusicAudio = playSfx(playerWonResult(msg) ? "victoryMusic" : "defeatMusic", 0.46);
  }

  function showResultOverlay(msg) {
    if (!resultOverlayEl) return;
    const playerWon = playerWonResult(msg);
    resultOverlayEl.classList.toggle("is-victory", playerWon);
    resultOverlayEl.classList.toggle("is-defeat", !playerWon);
    if (resultTitleEl) resultTitleEl.textContent = playerWon ? "VICTORY" : "DEFEAT";
    if (resultSubtitleEl) resultSubtitleEl.textContent = String(msg || "").replace(/\s*[-—]\s*Refresh to play again\.?$/i, "");
    resultOverlayEl.hidden = false;
    window.setTimeout(() => resultRematchBtn?.focus(), 80);
  }

  function endGame(msg) {
    state.activePlayer = "none";
    state.phase = "end";
    closeFieldSelection();
    closeTrapPrompt();
    closeDeckDialog();
    renderPhases();
    if (endTurnBtn) endTurnBtn.disabled = true;
    updateSurrenderButton();
    showStatus(msg, 60000);
    playResultSfx(msg);
    showResultOverlay(msg);
  }

  function surrenderDuel() {
    if (isDuelEnded() || !duelDeckCards.length) return;
    state.defeatedOwner = "player";
    state.playerLP = 0;
    state.pendingSpell = null;
    closeFieldSelection();
    state.resolvingSpell = false;
    state.resolvingEffectMonster = false;
    state.resolvingTrap = false;
    state.resolvingBattle = false;
    closeHandMenu();
    closeChoiceDialog();
    closeFieldSelection();
    closeTrapPrompt();
    closeSpellResolveButton();
    closeGraveyardDialog();
    closeDeckDialog();
    clearSlotHighlights();
    clearCardInfo();
    updateLP();
    endGame("You surrendered. AI wins.");
  }

  function startDuel(deckCards = duelDeckCards, options = {}) {
    const cards = Array.isArray(deckCards) ? deckCards.filter(Boolean) : [];
    if (!cards.length) return false;

    const firstPlayer = options.firstPlayer === "ai" ? "ai" : "player";
    duelDeckCards = [...cards];
    stopResultMusic();
    closeHandMenu();
    closeChoiceDialog();
    closeFieldSelection();
    closeTrapPrompt();
    closeSpellResolveButton();
    closeGraveyardDialog();
    closeDeckDialog();
    clearSlotHighlights();
    clearCardInfo();
    resetBattleLog();
    if (resultOverlayEl) resultOverlayEl.hidden = true;

    state.turn = 1;
    state.activePlayer = firstPlayer;
    state.startingPlayer = firstPlayer;
    state.phase = "draw";
    state.playerLP = MAX_LP;
    state.aiLP = MAX_LP;
    state.playerHand = [];
    state.aiHand = [];
    state.playerDeck = shuffle(duelDeckCards.map(createDuelCard));
    state.aiDeck = shuffle(duelDeckCards.map(createDuelCard));
    state.playerGY = [];
    state.aiGY = [];
    state.playerMonster = [null, null, null, null, null];
    state.playerSpellTrap = [null, null, null, null, null];
    state.aiMonster = [null, null, null, null, null];
    state.aiSpellTrap = [null, null, null, null, null];
    state.selectedHandIdx = null;
    state.pendingAction = null;
    state.pendingSpell = null;
    state.pendingFieldSelection = null;
    state.resolvingSpell = false;
    state.selectedAttackIdx = null;
    state.tributesPending = 0;
    state.tributesSelected = [];
    state.hasNormalSummoned = false;
    state.hasDrawn = false;
    state.battleEnteredThisTurn = false;
    state.monstersAttackedThisTurn = new Set();
    state.monsterAttackCountsThisTurn = new Map();
    state.monstersChangedModeThisTurn = new Set();
    state.effectMonsterUsesThisTurn = new Set();
    state.effectMonsterUsesEver = new Set();
    state.aiBattleRestrictedUntilTurn = 0;
    state.resolvingEffectMonster = false;
    state.resolvingTrap = false;
    state.resolvingBattle = false;
    state.resultSfxPlayed = false;
    state.defeatedOwner = null;

    const handSize = Math.min(5, Math.floor(state.playerDeck.length / 2));
    for (let i = 0; i < handSize; i++) state.playerHand.push(state.playerDeck.shift());
    for (let i = 0; i < handSize; i++) state.aiHand.push(state.aiDeck.shift());

    updateLP();
    updateCounts();
    renderPlayerHand();
    renderAiHand();
    renderField();
    setPhase("draw");

    const deckName = options.deckName ? `${options.deckName} selected. ` : "";
    if (firstPlayer === "ai") {
      showStatus(`${deckName}AI goes first.`, 1800);
      window.setTimeout(() => {
        if (!isDuelEnded() && state.activePlayer === "ai" && state.phase === "draw") {
          doAiTurn();
        }
      }, 900);
    } else {
      showStatus(`${deckName}${options.announce ? "Duel started" : "You go first"} - draw a card.`, 1800);
    }
    return true;
  }

  async function beginDuelSetup(options = {}) {
    if (!duelSetupDecks.length) {
      showStatus("No decks found! Create a deck first, then come back.", 10000);
      if (endTurnBtn) endTurnBtn.disabled = true;
      return false;
    }

    stopResultMusic();
    if (resultOverlayEl) resultOverlayEl.hidden = true;
    closeHandMenu();
    closeChoiceDialog();
    closeFieldSelection();
    closeTrapPrompt();
    closeSpellResolveButton();
    closeGraveyardDialog();
    closeDeckDialog();
    clearSlotHighlights();
    clearCardInfo();

    const selected = await promptDuelDeckChoice(duelSetupDecks, duelSetupCardMap);
    if (!selected) {
      window.location.href = "home.html";
      return false;
    }

    const rpsWinnerOwner = await promptRockPaperScissors();
    const firstPlayer = await chooseStartingPlayerAfterRps(rpsWinnerOwner);
    return startDuel(selected.cards, {
      ...options,
      announce: true,
      firstPlayer,
      deckName: duelDeckName(selected.deck)
    });
  }

  resultRematchBtn?.addEventListener("click", () => {
    stopResultMusic();
    beginDuelSetup({ announce: true });
  });

  resultExitBtn?.addEventListener("click", () => {
    stopResultMusic();
    window.location.href = "home.html";
  });

  surrenderBtn?.addEventListener("click", surrenderDuel);

  // ── Initialise ───────────────────────────────────────────
  async function init() {
    const user = await store.refreshSession().catch(() => null);
    if (!user) { window.location.href = "index.html"; return; }
    if (usernameEl) usernameEl.textContent = user.username || "You";

    showStatus("Loading deck…", 4000);

    let decks, cards;
    try {
      const library = await store.getLibrary();
      decks = library.decks;
      cards = library.cards;
    } catch {
      showStatus("Failed to load deck data — check the server.", 8000);
      return;
    }

    if (!decks.length) {
      showStatus("No decks found! Create a deck first, then come back.", 10000);
      if (endTurnBtn) endTurnBtn.disabled = true;
      return;
    }

    duelSetupDecks = [...decks].sort(
      (a, b) => new Date(b.savedAt || b.updatedAt || 0) - new Date(a.savedAt || a.updatedAt || 0)
    );
    duelSetupCardMap = Object.fromEntries(cards.map((card) => [card.id, card]));

    if (!duelSetupDecks.some((deck) => duelDeckCardsFor(deck, duelSetupCardMap).length > 0)) {
      showStatus("No playable decks found! Add valid cards to a deck first.", 8000);
      if (endTurnBtn) endTurnBtn.disabled = true;
      return;
    }

    attachSlotListeners();
    await beginDuelSetup();
  }

  init();
})();

