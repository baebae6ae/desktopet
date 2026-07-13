/**
 * cat-writing.js — "글쓰기" 카테고리 (블로그·이메일·자기소개서 등 일반 글쓰기).
 * 코딩 카테고리와 달리 nocalhostmore로 보내지 않고, 그 자리에서 완성 프롬프트를
 * 만들어 복사하게 한다(vendor/wizardEngine.js 참고).
 */
import { makeEngine, makeGuideBuilder } from "./wizardEngine.js";

export const id = "writing";
export const label = "글쓰기";
export const icon = "✍️";
export const desc = "블로그 · 이메일 · 자기소개서 등";

export const QUESTIONS = [
  {
    id: "topic",
    type: "text",
    title: "무슨 글을 쓰고 싶으신가요?",
    hint: "주제나 소재를 편하게 적어주세요.",
    placeholder: "예) 신입 개발자 자기소개서",
    required: true,
    next: "tone",
  },
  {
    id: "tone",
    type: "single",
    title: "어떤 말투로 쓸까요?",
    options: [
      { value: "formal", label: "정중하고 격식 있게", next: "length" },
      { value: "casual", label: "친근하고 편안하게", next: "length" },
      { value: "fun", label: "재미있고 유머러스하게", next: "length" },
      { value: "persuasive", label: "전문적이고 설득력 있게", next: "length" },
    ],
    recommend: "casual",
    recommendReason: "특별히 격식이 필요한 자리가 아니라면 편안한 말투가 가장 잘 읽혀요.",
  },
  {
    id: "length",
    type: "single",
    title: "분량은 어느 정도로 할까요?",
    options: [
      { value: "short", label: "짧게 핵심만", desc: "3~5문장", next: "audience" },
      { value: "medium", label: "중간 길이", desc: "문단 여러 개", next: "audience" },
      { value: "long", label: "길고 자세하게", desc: "배경 설명·예시 포함", next: "audience" },
    ],
    recommend: "medium",
    recommendReason: "대부분의 글은 중간 길이가 가장 무난해요.",
  },
  {
    id: "audience",
    type: "text",
    title: "누가 읽을 글인가요?",
    hint: "독자를 알면 더 잘 맞는 글이 나와요. 없으면 비워두셔도 돼요.",
    placeholder: "예) 채용 담당자, 블로그 구독자",
    required: false,
    guideTerm: "Target Reader",
    next: null,
  },
];

export const START_ID = "topic";
const { getQuestion, resolveNext } = makeEngine(QUESTIONS, START_ID);
export { getQuestion, resolveNext };

const GUIDE = {
  "tone:formal": { term: "Formal Register", title: "격식체 지정", detail: "정중하고 격식 있는 어투로 써달라고 명시하면 문장체가 통일돼요." },
  "tone:casual": { term: "Casual Tone", title: "친근한 어투 지정", detail: "구어체·편안한 표현을 써달라고 하면 딱딱하지 않은 글이 나와요." },
  "tone:fun": { term: "Playful Tone", title: "유머러스한 톤 지정", detail: "위트 있는 비유나 가벼운 농담을 섞어달라고 요청하면 지루하지 않은 글이 돼요." },
  "tone:persuasive": { term: "Persuasive Framing", title: "설득형 구조 요청", detail: "주장-근거-결론 구조로 설득력 있게 써달라고 요청하세요." },
  "length:short": { term: "Concise", title: "분량 짧게 제한", detail: "핵심만 3~5문장으로 압축해달라고 명시하면 군더더기가 줄어요." },
  "length:medium": { term: "Standard Length", title: "표준 분량 요청", detail: "몇 개 문단으로 자연스럽게 풀어달라고 요청하세요." },
  "length:long": { term: "In-depth", title: "상세 분량 요청", detail: "배경 설명과 예시까지 포함해 길고 자세하게 써달라고 요청하세요." },
};
export const buildGuide = makeGuideBuilder(QUESTIONS, GUIDE);

const TONE_LABEL = { formal: "정중하고 격식 있게", casual: "친근하고 편안하게", fun: "재미있고 유머러스하게", persuasive: "전문적이고 설득력 있게" };
const LENGTH_LABEL = { short: "짧게, 핵심만 3~5문장", medium: "중간 길이, 몇 개 문단", long: "길고 자세하게, 배경 설명 포함" };

export function buildPrompt(answers) {
  const a = answers || {};
  const lines = [];
  lines.push(`"${(a.topic || "").trim()}"에 대한 글을 써줘.`, "");
  lines.push(`- 말투: ${TONE_LABEL[a.tone] || TONE_LABEL.casual}`);
  lines.push(`- 분량: ${LENGTH_LABEL[a.length] || LENGTH_LABEL.medium}`);
  if (a.audience) lines.push(`- 독자: ${a.audience}`);
  lines.push("", "문단 구성과 표현에 신경 써서, 자연스럽고 완성도 있게 작성해줘.");
  return lines.join("\n");
}
