/**
 * cat-debug.js — "에러 고치기" 카테고리 (버그/에러 디버깅 프롬프트).
 */
import { makeEngine, makeGuideBuilder } from "./wizardEngine.js";

export const id = "debug";
export const label = "에러 고치기";
export const icon = "🐛";
export const desc = "막힌 버그를 해결하고 싶어요";

export const QUESTIONS = [
  {
    id: "errorDesc",
    type: "text",
    title: "어떤 문제가 생겼나요?",
    hint: "에러 메시지나 증상을 최대한 그대로 붙여넣어주세요.",
    placeholder: "예) TypeError: Cannot read properties of undefined (reading 'map')",
    required: true,
    next: "context",
  },
  {
    id: "context",
    type: "text",
    title: "어떤 상황에서 발생했나요?",
    hint: "무엇을 하려다가, 어떤 동작 중에 발생했는지 적어주세요.",
    placeholder: "예) API에서 받아온 데이터를 화면에 리스트로 뿌리려고 했어요",
    required: true,
    guideTerm: "Repro Context",
    next: "stack",
  },
  {
    id: "stack",
    type: "text",
    title: "어떤 언어나 프로그램에서 생긴 문제인가요?",
    hint: "없으면 비워두셔도 돼요.",
    placeholder: "예) React, Python, 엑셀 매크로 등",
    required: false,
    guideTerm: "Environment",
    next: "tried",
  },
  {
    id: "tried",
    type: "text",
    title: "이미 시도해본 게 있나요?",
    hint: "없으면 비워두셔도 돼요.",
    placeholder: "예) 콘솔 로그 찍어봤는데 데이터가 비어있었어요",
    required: false,
    guideTerm: "Attempted Fixes",
    next: null,
  },
];

export const START_ID = "errorDesc";
const { getQuestion, resolveNext } = makeEngine(QUESTIONS, START_ID);
export { getQuestion, resolveNext };

const GUIDE = {};
export const buildGuide = makeGuideBuilder(QUESTIONS, GUIDE);

export function buildPrompt(answers) {
  const a = answers || {};
  const lines = ["다음 에러/문제를 해결하는 걸 도와줘.", "", "[에러 내용]", (a.errorDesc || "").trim(), "", "[발생 상황]", (a.context || "").trim()];
  if (a.stack) lines.push("", `[환경] ${a.stack}`);
  if (a.tried) lines.push("", `[이미 시도한 것] ${a.tried}`);
  lines.push("", "원인을 짚어주고, 구체적인 해결 방법과 수정된 코드를 알려줘. 왜 이 문제가 생겼는지도 간단히 설명해줘.");
  return lines.join("\n");
}
