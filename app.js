const passwordButtons = Array.from(document.querySelectorAll("[data-toggle-password]"));
const forms = Array.from(document.querySelectorAll("[data-form]"));
const isProtectedPage = Boolean(document.querySelector(".home, [data-card-library], [data-card-creator]"));
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

window.BattleOfCreationsStore = {
  getCurrentUser,
  refreshSession,
  getMyCards,
  getMyDecks,
  saveCard,
  saveDeck,
  deleteCards
};

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

  hydrateCurrentUserUI();
  return user;
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
        ["Effect Type", selectedCard.effect || "None"],
        ["Cause", selectedCard.effectCause || DEFAULT_EFFECT_CAUSE],
        ["Effects", cardEffectOutcome(selectedCard)],
        ["Usage", selectedCard.effectOncePerTurn ? "Once per turn" : "Once after summoned"],
        ["Short Effect Description", cardEffectDescription(selectedCard)]
      );
    } else if (isNormalMonster(selectedCard)) {
      rows.push(["Short Description", selectedCard.shortDescription || "None"]);
    } else if (selectedType === "spell") {
      rows.push(
        ["Effect", selectedCard.spellEffectLabel || selectedCard.spellEffect || "None"],
        ["Effect Description", selectedCard.spellEffectDescription || "None"]
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
    return combineEffectStatements(getField("effectCause")?.value, currentEffectOutcome()) ||
      "No effect description has been written for this card yet.";
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
        return "Revive a monster from the player's graveyard.";
      case "increase-lp": {
        const amount = getField("spellLpAmount")?.value || "500";
        return `Increase the player's life points by ${amount}.`;
      }
      case "decrease-lp": {
        const amount = getField("spellLpAmount")?.value || "500";
        return `Decrease the opponent's life points by ${amount}.`;
      }
      case "return-graveyard": {
        const type = getField("spellGraveyardType")?.value || "monster";
        const dest = getField("spellGraveyardDest")?.value || "deck";
        return `Return a ${type} card from the player's graveyard to the ${dest}.`;
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
    const shouldUseEffectDescription = !isSpell && usesEffectFields(draftCardType, draftMonsterType);
    const shouldUseEffectUsage = !isSpell && usesEffectUsage(draftCardType, draftMonsterType);
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
