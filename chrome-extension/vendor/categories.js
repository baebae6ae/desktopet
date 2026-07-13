/**
 * categories.js — 위저드가 첫 화면에서 보여주는 "오늘은 뭘 도와드릴까요?" 목록.
 *
 * "coding"은 특별 취급이다: 기존 questions.js/guideBuilder.js/share.js를 그대로 써서
 * nocalhostmore로 답변을 넘기는 유입 퍼널을 유지한다(pet.js가 이 id를 보고 분기).
 * 나머지 카테고리는 이 파일이 자체적으로 질문·가이드·완성 프롬프트까지 다 만든다
 * (사이트로 안 보내고 그 자리에서 복사하게 함 — wizardEngine.js 참고).
 */
import * as writing from "./cat-writing.js";
import * as debugCat from "./cat-debug.js";
import * as summarize from "./cat-summarize.js";
import * as image from "./cat-image.js";

export const CODING = { id: "coding", label: "코딩 프로젝트", icon: "🧑‍💻", desc: "앱 · 웹사이트를 만들고 싶어요" };

const LOCAL_CATEGORIES = [writing, debugCat, summarize, image];

export const CATEGORIES = [CODING, ...LOCAL_CATEGORIES.map((m) => ({ id: m.id, label: m.label, icon: m.icon, desc: m.desc }))];

export function getLocalCategory(id) {
  return LOCAL_CATEGORIES.find((m) => m.id === id) || null;
}
