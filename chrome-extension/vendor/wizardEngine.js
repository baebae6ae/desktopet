/**
 * wizardEngine.js — 코딩 이외 카테고리(글쓰기/디버깅/요약/이미지)가 공용으로 쓰는
 * 아주 작은 위저드 엔진 + 가이드 빌더 헬퍼.
 *
 * 중요: 코딩 카테고리(questions.js/guideBuilder.js/share.js)는 이 파일과 무관하게
 * 원래 모습 그대로 남는다 — nocalhostmore로의 유입 퍼널이라 손대면 안 된다.
 * 여기서 만드는 다른 카테고리들은 nocalhostmore가 이해 못 하는 답변 모양이라,
 * 사이트로 보내지 않고 그 자리에서 바로 완성 프롬프트를 만들어 복사하게 한다.
 */

/** id로 질문 찾기 + 다음 질문 계산 (questions.js의 로직과 동일한 규칙) */
export function makeEngine(QUESTIONS, START_ID) {
  function getQuestion(id) {
    return QUESTIONS.find((q) => q.id === id) || null;
  }
  function resolveNext(question, selectedValue, answers) {
    let n = question.next;
    if (question.type === "single") {
      const opt = question.options.find((o) => o.value === selectedValue);
      if (opt && opt.next !== undefined) n = opt.next;
    }
    if (typeof n === "function") return n(answers || {});
    return n || null;
  }
  return { QUESTIONS, START_ID, getQuestion, resolveNext };
}

/**
 * 답변 → { idea, items[] } 가이드 빌더 팩토리.
 * 첫 번째 질문의 답을 헤드라인(idea)으로 쓰고, 나머지는 single이면 GUIDE 맵에서
 * 용어 뱃지를 찾고, text면 질문 자체를 용어처럼 보여준다.
 */
export function makeGuideBuilder(QUESTIONS, GUIDE) {
  return function buildGuide(answers) {
    const a = answers || {};
    const headlineId = QUESTIONS[0].id;
    const idea = (a[headlineId] || "").trim();
    const items = [];
    for (const q of QUESTIONS) {
      if (q.id === headlineId) continue;
      const v = a[q.id];
      if (v == null || v === "") continue;
      if (q.type === "single") {
        const g = GUIDE[`${q.id}:${v}`];
        if (g) items.push(g);
      } else {
        items.push({ term: q.guideTerm || q.title, title: q.title, detail: v });
      }
    }
    return { idea, items };
  };
}
