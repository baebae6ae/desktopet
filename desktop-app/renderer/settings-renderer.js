"use strict";

(function () {
  const api = window.desktopPetSettings;

  const spawnButtonsEl = document.getElementById("spawn-buttons");
  const listEl = document.getElementById("pet-list");
  const listEmptyEl = document.getElementById("pet-list-empty");
  const resetBtn = document.getElementById("reset-btn");
  const statusEl = document.getElementById("status");

  let statusTimer = null;
  function setStatus(msg, isError) {
    statusEl.textContent = msg;
    statusEl.dataset.error = isError ? "true" : "false";
    clearTimeout(statusTimer);
    statusTimer = setTimeout(() => {
      statusEl.textContent = "";
    }, 4000);
  }

  function renderList(list) {
    while (listEl.firstChild) listEl.removeChild(listEl.firstChild);
    listEmptyEl.style.display = list.length ? "none" : "block";

    list.forEach((pet) => {
      const speciesLabel =
        api.SPECIES.find((s) => s.id === pet.species)?.label || pet.species;

      const li = document.createElement("li");
      li.className = "pet-row";

      const speciesEl = document.createElement("span");
      speciesEl.className = "pet-row__species";
      speciesEl.textContent = speciesLabel;

      const nameInput = document.createElement("input");
      nameInput.className = "pet-row__name-input";
      nameInput.type = "text";
      nameInput.maxLength = api.NAME_MAX_LEN;
      nameInput.value = pet.name;
      nameInput.setAttribute("aria-label", `${speciesLabel} 이름 변경`);
      nameInput.addEventListener("change", async () => {
        const result = await api.rename(pet.id, nameInput.value);
        if (result.ok) {
          nameInput.value = result.name;
          setStatus(`이름이 "${result.name}"(으)로 변경되었습니다.`);
        } else {
          nameInput.value = pet.name;
          setStatus(result.reason || "이름을 변경할 수 없습니다.", true);
        }
      });

      const affectionEl = document.createElement("span");
      affectionEl.className = "pet-row__affection";
      affectionEl.textContent = `애정도 ${pet.affection}`;

      const removeBtn = document.createElement("button");
      removeBtn.type = "button";
      removeBtn.className = "btn btn--small btn--danger";
      removeBtn.textContent = "삭제";
      removeBtn.addEventListener("click", () => api.remove(pet.id));

      li.appendChild(speciesEl);
      li.appendChild(nameInput);
      li.appendChild(affectionEl);
      li.appendChild(removeBtn);
      listEl.appendChild(li);
    });
  }

  api.SPECIES.forEach((species) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "btn btn--spawn";
    btn.textContent = `+ ${species.label}`;
    btn.addEventListener("click", async () => {
      await api.spawn(species.id);
      setStatus(`${species.label}을(를) 추가했어요.`);
    });
    spawnButtonsEl.appendChild(btn);
  });

  resetBtn.addEventListener("click", async () => {
    const result = await api.resetAll();
    if (result.ok) setStatus("모든 캐릭터가 초기화되었습니다.");
  });

  api.onListChanged((list) => renderList(list));
  api.getList().then(renderList);
})();
