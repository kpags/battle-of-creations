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
  saveCard,
  saveDeck,
  deleteCards,
  deleteDecks
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

  if (isGuestPage && user) {
    window.location.href = "home.html";
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
      [allDecks, allCards] = await Promise.all([
        window.BattleOfCreationsStore.getMyDecks(),
        window.BattleOfCreationsStore.getMyCards()
      ]);
      renderDeckDetail();
      renderDecks();
    } catch (error) {
      if (deckCountLabel) deckCountLabel.textContent = error.message || "Decks could not be loaded.";
    }
  }

  deckSearchInput?.addEventListener("input", () => { deckCurrentPage = 1; renderDecks(); });
  deckSortSelect?.addEventListener("change", () => { deckCurrentPage = 1; renderDecks(); });
  deckDeleteModeButton?.addEventListener("click", () => setDeckDeleteMode(!deckDeleteMode));
  deckCancelDeleteButton?.addEventListener("click", () => setDeckDeleteMode(false));
  deckConfirmDeleteButton?.addEventListener("click", openDeckDeleteDialog);
  deckCancelConfirmDeleteButton?.addEventListener("click", closeDeckDeleteDialog);
  deckRunDeleteButton?.addEventListener("click", runBulkDeckDelete);
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
    btn.addEventListener("click", () => {
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
      dcAllCards = await window.BattleOfCreationsStore.getMyCards();
      if (editDeckId) {
        if (dcTitleEl) dcTitleEl.textContent = "Edit Deck";
        const decks = await window.BattleOfCreationsStore.getMyDecks();
        const existing = decks.find((d) => d.id === editDeckId);
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
  function cardNameStr(card) { return String(card.cardName || "Unnamed"); }

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
    hasNormalSummoned: false,
    hasDrawn: false,
    monstersAttackedThisTurn: new Set()
  };

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
  const playerGYCount   = $("[data-player-gy-count]");
  const aiGYCount       = $("[data-ai-gy-count]");
  const playerGYSlot    = $("[data-player-gy]");
  const aiGYSlot        = $("[data-ai-gy]");
  const playerMonZone   = $("[data-player-monster]");
  const playerSTZone    = $("[data-player-spelltrap]");
  const aiMonZone       = $("[data-ai-monster]");
  const aiSTZone        = $("[data-ai-spelltrap]");
  const statusEl        = $("[data-bf-status]");
  const statusMsgEl     = $("[data-bf-status-msg]");
  const endTurnBtn      = $("[data-bf-end-turn]");
  const usernameEl      = $("[data-bf-username]");
  const phaseButtons    = Array.from(document.querySelectorAll("[data-bf-phase]"));
  const drawPromptEl    = $("[data-draw-prompt]");
  // Card info pane
  const cardInfoEl      = $("[data-card-info]");
  const ciArtEl         = $("[data-ci-art]");
  const ciNameEl        = $("[data-ci-name]");
  const ciTypeEl        = $("[data-ci-type]");
  const ciStatsEl       = $("[data-ci-stats]");
  const ciAtkEl         = $("[data-ci-atk]");
  const ciDefEl         = $("[data-ci-def]");
  const ciDescEl        = $("[data-ci-desc]");

  let statusTimer = null;

  function showStatus(msg, duration = 2800) {
    if (!statusEl || !statusMsgEl) return;
    statusMsgEl.textContent = msg;
    statusEl.hidden = false;
    clearTimeout(statusTimer);
    statusTimer = setTimeout(() => { statusEl.hidden = true; }, duration);
  }

  // ── Render helpers ────────────────────────────────────────
  const MAX_LP = 8000;

  function updateLP() {
    if (playerLpEl) playerLpEl.textContent = state.playerLP;
    if (aiLpEl)     aiLpEl.textContent     = state.aiLP;
    if (playerLpFill) {
      const pct = Math.max(0, (state.playerLP / MAX_LP) * 100);
      playerLpFill.style.height = pct + "%";
      playerLpFill.classList.toggle("is-low", pct <= 25);
    }
    if (aiLpFill) {
      const pct = Math.max(0, (state.aiLP / MAX_LP) * 100);
      aiLpFill.style.height = pct + "%";
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

  function renderSlot(slotEl, card, faceDown) {
    slotEl.innerHTML = "";
    if (!card) {
      slotEl.classList.remove("is-filled");
      return;
    }
    slotEl.classList.add("is-filled");
    if (faceDown) {
      const back = document.createElement("div");
      back.className = "bf-slot-face bf-card-back";
      slotEl.appendChild(back);
      return;
    }
    const isMonster = cardTypeName(card) === "monster";
    const face = document.createElement("div");
    face.className = "bf-slot-face";

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
  }

  function renderField() {
    const pmSlots = Array.from(playerMonZone.querySelectorAll(".bf-slot"));
    pmSlots.forEach((el, i) => {
      renderSlot(el, state.playerMonster[i], false);
      if (state.playerMonster[i]) {
        el.addEventListener("mouseenter", () => showCardInfo(state.playerMonster[i]));
        el.addEventListener("mouseleave", clearCardInfo);
      }
    });

    const psSlots = Array.from(playerSTZone.querySelectorAll(".bf-slot"));
    psSlots.forEach((el, i) => {
      renderSlot(el, state.playerSpellTrap[i], false);
      if (state.playerSpellTrap[i]) {
        el.addEventListener("mouseenter", () => showCardInfo(state.playerSpellTrap[i]));
        el.addEventListener("mouseleave", clearCardInfo);
      }
    });

    const amSlots = Array.from(aiMonZone.querySelectorAll(".bf-slot"));
    amSlots.forEach((el, i) => {
      renderSlot(el, state.aiMonster[i], false);
      if (state.aiMonster[i]) {
        el.addEventListener("mouseenter", () => showCardInfo(state.aiMonster[i]));
        el.addEventListener("mouseleave", clearCardInfo);
      }
    });

    const asSlots = Array.from(aiSTZone.querySelectorAll(".bf-slot"));
    asSlots.forEach((el, i) => renderSlot(el, state.aiSpellTrap[i], !!state.aiSpellTrap[i]));
  }

  function renderPlayerHand() {
    if (!playerHandEl) return;
    playerHandEl.innerHTML = "";
    state.playerHand.forEach((card, i) => {
      const el = document.createElement("div");
      el.className = "bf-hand-card";
      if (state.selectedHandIdx === i) el.classList.add("is-selected");

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

      el.addEventListener("mouseenter", () => showCardInfo(card));
      el.addEventListener("mouseleave", () => { if (state.selectedHandIdx !== i) clearCardInfo(); });
      el.addEventListener("click",       () => selectHandCard(i));
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
  }

  function setPhase(phase) {
    state.phase = phase;
    renderPhases();
    updateDrawPrompt();
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
  function drawCard(player) {
    if (player === "player") {
      if (!state.playerDeck.length) { endGame("AI wins — you ran out of cards!"); return false; }
      state.playerHand.push(state.playerDeck.shift());
      renderPlayerHand();
    } else {
      if (!state.aiDeck.length) { endGame("You win — AI ran out of cards!"); return false; }
      state.aiHand.push(state.aiDeck.shift());
      renderAiHand();
    }
    updateCounts();
    return true;
  }

  // ── Select a hand card ──────────────────────────────────
  function selectHandCard(idx) {
    if (state.activePlayer !== "player") return;
    if (state.phase !== "main1" && state.phase !== "main2") {
      showStatus("You can only play cards during Main Phase 1 or 2");
      return;
    }
    const wasSelected = state.selectedHandIdx === idx;
    state.selectedHandIdx = wasSelected ? null : idx;
    renderPlayerHand();
    if (state.selectedHandIdx !== null) {
      highlightAvailableSlots(state.playerHand[idx]);
    } else {
      clearSlotHighlights();
    }
  }

  // ── Play a card from hand to field ─────────────────────
  function playToSlot(fieldArr, slotIdx, isMonsterZone) {
    if (state.activePlayer !== "player") return;
    if (state.phase !== "main1" && state.phase !== "main2") {
      showStatus("You can only play cards during a Main Phase"); return;
    }
    if (state.selectedHandIdx === null) {
      showStatus("Select a card from your hand first"); return;
    }
    if (fieldArr[slotIdx] !== null) {
      showStatus("That slot is already occupied"); return;
    }

    const card = state.playerHand[state.selectedHandIdx];
    const t = cardTypeName(card);

    if (isMonsterZone && t !== "monster") {
      showStatus("Monsters only go in the Monster Zone"); return;
    }
    if (!isMonsterZone && t === "monster") {
      showStatus("Spell / Trap cards go in the Spell / Trap Zone"); return;
    }
    if (isMonsterZone && state.hasNormalSummoned) {
      showStatus("You can only Normal Summon once per turn"); return;
    }

    fieldArr[slotIdx] = { ...card };
    state.playerHand.splice(state.selectedHandIdx, 1);
    state.selectedHandIdx = null;
    if (isMonsterZone) state.hasNormalSummoned = true;

    clearSlotHighlights();
    renderField();
    renderPlayerHand();
  }

  // ── Attach slot click listeners ─────────────────────────
  function attachSlotListeners() {
    // Player monster slots
    Array.from(playerMonZone.querySelectorAll(".bf-slot")).forEach((slot, i) => {
      slot.addEventListener("click", () => {
        if (state.phase === "battle" && state.activePlayer === "player") {
          attackWithMonster(i);
        } else {
          playToSlot(state.playerMonster, i, true);
        }
      });
    });

    // Player spell/trap slots
    Array.from(playerSTZone.querySelectorAll(".bf-slot")).forEach((slot, i) => {
      slot.addEventListener("click", () => {
        playToSlot(state.playerSpellTrap, i, false);
      });
    });
  }

  // ── Player attacks ──────────────────────────────────────
  function attackWithMonster(slotIdx) {
    const attacker = state.playerMonster[slotIdx];
    if (!attacker) { showStatus("No monster in that slot"); return; }
    if (state.monstersAttackedThisTurn.has(slotIdx)) { showStatus("That monster already attacked this turn"); return; }

    const atkSlotEl = playerMonZone.querySelectorAll(".bf-slot")[slotIdx];
    atkSlotEl?.classList.add("is-attacking");
    setTimeout(() => atkSlotEl?.classList.remove("is-attacking"), 960);

    const atk = cardAtk(attacker);
    const targetIdx = state.aiMonster.findIndex((m) => m !== null);

    if (targetIdx >= 0) {
      // Attack a monster
      const defender  = state.aiMonster[targetIdx];
      const def       = cardDef(defender);

      if (atk > def) {
        const dmg = atk - def;
        state.aiLP = Math.max(0, state.aiLP - dmg);
        state.aiGY.push(state.aiMonster[targetIdx]);
        state.aiMonster[targetIdx] = null;
        updateLP();
        damageFlash($(".bf-ai-lp-bar"));
        showStatus(`${cardNameStr(attacker)} destroys ${cardNameStr(defender)}! AI takes ${dmg} damage!`);
      } else if (atk < def) {
        const dmg = def - atk;
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
        showStatus("Both monsters are destroyed!");
      }
    } else {
      // Direct attack
      state.aiLP = Math.max(0, state.aiLP - atk);
      updateLP();
      damageFlash($(".bf-ai-lp-bar"));
      showStatus(`${cardNameStr(attacker)} attacks directly for ${atk} damage!`);
    }

    state.monstersAttackedThisTurn.add(slotIdx);
    renderField();
    updateCounts();

    if (state.aiLP <= 0) endGame("You Win! 🏆");
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
      if (isMonster && ciAtkEl && ciDefEl) {
        ciAtkEl.textContent = cardAtk(card);
        ciDefEl.textContent = cardDef(card);
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
    if (ciDescEl) ciDescEl.textContent = "";
  }

  // ── Slot highlights ─────────────────────────────
  function clearSlotHighlights() {
    document.querySelectorAll(".bf-slot.is-target").forEach(el => el.classList.remove("is-target"));
  }

  function highlightAvailableSlots(card) {
    clearSlotHighlights();
    if (!card) return;
    const t = cardTypeName(card);
    if (t === "monster") {
      Array.from(playerMonZone.querySelectorAll(".bf-slot")).forEach((slot, i) => {
        if (state.playerMonster[i] === null) slot.classList.add("is-target");
      });
    } else {
      Array.from(playerSTZone.querySelectorAll(".bf-slot")).forEach((slot, i) => {
        if (state.playerSpellTrap[i] === null) slot.classList.add("is-target");
      });
    }
  }

  // ── Phase button clicks ─────────────────────────────────
  const phaseOrder = ["draw", "main1", "battle", "main2", "end"];

  phaseButtons.forEach((btn) => {
    btn.addEventListener("click", () => {
      if (state.activePlayer !== "player") return;
      const current = phaseOrder.indexOf(state.phase);
      const target  = phaseOrder.indexOf(btn.dataset.bfPhase);

      if (target <= current) return; // can't go backwards

      // Handle draw phase manually if user clicks Draw Phase
      if (btn.dataset.bfPhase === "draw") return;

      setPhase(btn.dataset.bfPhase);

      if (btn.dataset.bfPhase === "battle") {
        state.monstersAttackedThisTurn.clear();
        showStatus("Battle Phase — click your monsters to attack!", 3000);
      }
      if (btn.dataset.bfPhase === "main2") {
        showStatus("Main Phase 2 — play more cards or end your turn", 2500);
      }
    });
  });

  // ── Draw via deck prompt or clicking the deck pile ──────
  function doDraw() {
    if (state.activePlayer !== "player") return;
    if (state.phase !== "draw") return;
    if (state.hasDrawn) { showStatus("Already drew this turn!"); return; }
    if (!drawCard("player")) return;
    state.hasDrawn = true;
    updateDrawPrompt();
    setTimeout(() => setPhase("main1"), 600);
  }

  drawPromptEl?.addEventListener("click", doDraw);
  $("[data-player-deck]")?.addEventListener("click", doDraw);

  // End Turn button
  endTurnBtn?.addEventListener("click", () => {
    if (state.activePlayer !== "player") return;
    endPlayerTurn();
  });

  // ── Player ends turn ────────────────────────────────────
  function endPlayerTurn() {
    state.activePlayer = "ai";
    if (endTurnBtn) endTurnBtn.disabled = true;
    setPhase("end");
    showStatus("Your turn ended — AI is thinking…", 1500);
    setTimeout(doAiTurn, 1800);
  }

  // ── AI turn ──────────────────────────────────────────────
  async function doAiTurn() {
    // Draw Phase
    setPhase("draw");
    if (!drawCard("ai")) return;

    await sleep(1300);

    // Main Phase 1 — try to play one card
    setPhase("main1");
    let played = false;

    if (state.aiHand.length) {
      // Prefer monsters
      const monIdx = state.aiHand.findIndex((c) => cardTypeName(c) === "monster");
      const stIdx  = state.aiHand.findIndex((c) => cardTypeName(c) !== "monster");
      const emptyMon = state.aiMonster.indexOf(null);
      const emptyST  = state.aiSpellTrap.indexOf(null);

      if (monIdx >= 0 && emptyMon >= 0) {
        const [card] = state.aiHand.splice(monIdx, 1);
        state.aiMonster[emptyMon] = { ...card };
        showStatus(`AI summons ${cardNameStr(card)}!`, 1400);
        played = true;
      } else if (stIdx >= 0 && emptyST >= 0) {
        const [card] = state.aiHand.splice(stIdx, 1);
        state.aiSpellTrap[emptyST] = { ...card };
        showStatus("AI sets a card face-down.", 1400);
        played = true;
      }

      if (played) {
        renderField();
        renderAiHand();
        await sleep(1600);
      }
    }

    // Battle Phase
    setPhase("battle");
    await sleep(1200);

    for (let i = 0; i < 5; i++) {
      const attacker = state.aiMonster[i];
      if (!attacker) continue;

      const atk = cardAtk(attacker);
      const atkSlotEl = aiMonZone.querySelectorAll(".bf-slot")[i];
      atkSlotEl?.classList.add("is-attacking");
      await sleep(960);
      atkSlotEl?.classList.remove("is-attacking");

      const targetIdx = state.playerMonster.findIndex((m) => m !== null);

      if (targetIdx >= 0) {
        const defender = state.playerMonster[targetIdx];
        const def = cardDef(defender);
        const defSlotEl = playerMonZone.querySelectorAll(".bf-slot")[targetIdx];

        if (atk > def) {
          const dmg = atk - def;
          state.playerLP = Math.max(0, state.playerLP - dmg);
          state.playerGY.push(state.playerMonster[targetIdx]);
          state.playerMonster[targetIdx] = null;
          updateLP();
          damageFlash($(".bf-player-lp-bar"));
          showStatus(`${cardNameStr(attacker)} destroys ${cardNameStr(defender)}! You take ${dmg} damage!`);
        } else if (atk < def) {
          const dmg = def - atk;
          state.aiLP = Math.max(0, state.aiLP - dmg);
          state.aiGY.push(state.aiMonster[i]);
          state.aiMonster[i] = null;
          updateLP();
          damageFlash($(".bf-ai-lp-bar"));
          showStatus(`${cardNameStr(defender)} destroys ${cardNameStr(attacker)}! AI takes ${dmg} damage!`);
        } else {
          state.aiGY.push(state.aiMonster[i]);
          state.playerGY.push(state.playerMonster[targetIdx]);
          state.aiMonster[i] = null;
          state.playerMonster[targetIdx] = null;
          showStatus("Both monsters are destroyed!");
        }

        renderField();
        updateCounts();
        await sleep(2000);
      } else {
        // Direct attack
        if (atk > 0) {
          state.playerLP = Math.max(0, state.playerLP - atk);
          updateLP();
          damageFlash($(".bf-player-lp-bar"));
          showStatus(`${cardNameStr(attacker)} attacks directly for ${atk} damage!`);
          await sleep(2000);
        }
      }

      if (state.playerLP <= 0) { endGame("AI Wins! Better luck next time."); return; }
    }

    // End Phase → start player turn
    setPhase("end");
    await sleep(900);

    state.turn++;
    state.activePlayer = "player";
    state.hasNormalSummoned = false;
    state.hasDrawn = false;
    state.monstersAttackedThisTurn.clear();

    // Give control back — player clicks the deck prompt to draw
    setPhase("draw");   // updateDrawPrompt() fires inside setPhase
    if (endTurnBtn) endTurnBtn.disabled = false;
  }

  // ── End game ─────────────────────────────────────────────
  function endGame(msg) {
    state.activePlayer = "none";
    state.phase = "end";
    renderPhases();
    if (endTurnBtn) endTurnBtn.disabled = true;
    showStatus(`${msg} — Refresh to play again`, 60000);
  }

  // ── Initialise ───────────────────────────────────────────
  async function init() {
    const user = await store.refreshSession().catch(() => null);
    if (!user) { window.location.href = "index.html"; return; }
    if (usernameEl) usernameEl.textContent = user.username || "You";

    showStatus("Loading deck…", 4000);

    let decks, cards;
    try {
      [decks, cards] = await Promise.all([store.getMyDecks(), store.getMyCards()]);
    } catch {
      showStatus("Failed to load deck data — check the server.", 8000);
      return;
    }

    if (!decks.length) {
      showStatus("No decks found! Create a deck first, then come back.", 10000);
      if (endTurnBtn) endTurnBtn.disabled = true;
      return;
    }

    // Pick latest deck by savedAt / updatedAt
    const sorted = [...decks].sort(
      (a, b) => new Date(b.savedAt || b.updatedAt || 0) - new Date(a.savedAt || a.updatedAt || 0)
    );
    const deck = sorted[0];
    const cardMap = Object.fromEntries(cards.map((c) => [c.id, c]));
    const deckCards = (Array.isArray(deck.cardIds) ? deck.cardIds : [])
      .map((id) => cardMap[id])
      .filter(Boolean);

    if (!deckCards.length) {
      showStatus("Your latest deck has no valid cards!", 8000);
      if (endTurnBtn) endTurnBtn.disabled = true;
      return;
    }

    state.playerDeck = shuffle([...deckCards]);
    state.aiDeck     = shuffle([...deckCards]);   // AI uses same card pool, different shuffle

    // Opening hand (up to 5 cards)
    const handSize = Math.min(5, Math.floor(state.playerDeck.length / 2));
    for (let i = 0; i < handSize; i++) state.playerHand.push(state.playerDeck.shift());
    for (let i = 0; i < handSize; i++) state.aiHand.push(state.aiDeck.shift());

    updateLP();
    updateCounts();
    renderPlayerHand();
    renderAiHand();
    renderField();
    attachSlotListeners();
    setPhase("draw");
  }

  init();
})();

