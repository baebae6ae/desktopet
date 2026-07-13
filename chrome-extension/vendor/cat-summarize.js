/**
 * cat-summarize.js — "요약·정리" 카테고리 (회의록/아티클/보고서 등 긴 글 요약).
 */
import { makeEngine, makeGuideBuilder } from "./wizardEngine.js";

export const id = "summarize";
export const label = "요약 · 정리";
export const icon = "📝";
export const desc = "긴 글을 간단하게 정리하고 싶어요";

export const QUESTIONS = [
  {
    id: "content",
    type: "text",
    title: "요약할 내용을 여기에 붙여넣어 주세요",
    hint: "회의록, 기사, 보고서 등 원문 그대로 붙여넣으면 돼요.",
    placeholder: "여기에 원문을 붙여넣으세요",
    required: true,
    next: "source",
  },
  {
    id: "source",
    type: "single",
    title: "뭘 요약하고 싶으신가요?",
    options: [
      { value: "meeting", label: "회의록 · 대화 내용", next: "purpose" },
      { value: "article", label: "뉴스 · 아티클", next: "purpose" },
      { value: "report", label: "논문 · 보고서", next: "purpose" },
      { value: "other", label: "기타 긴 글", next: "purpose" },
    ],
    recommend: "other",
    recommendReason: "애매하면 기타로 골라도 괜찮아요, 결과 품질에 큰 차이는 없어요.",
  },
  {
    id: "purpose",
    type: "single",
    title: "요약은 어디에 쓰실 건가요?",
    options: [
      { value: "skim", label: "핵심만 빠르게 파악", next: "format" },
      { value: "share", label: "팀원 · 상사에게 공유", next: "format" },
      { value: "archive", label: "나중에 다시 찾아볼 기록용", next: "format" },
    ],
    recommend: "skim",
    recommendReason: "대부분은 핵심 파악용이면 충분해요.",
  },
  {
    id: "format",
    type: "single",
    title: "결과물 형태는요?",
    options: [
      { value: "paragraph", label: "짧은 문단 몇 줄", next: null },
      { value: "bullets", label: "불릿포인트 목록", next: null },
      { value: "table", label: "표로 정리", next: null },
    ],
    recommend: "bullets",
    recommendReason: "불릿포인트가 가장 눈에 잘 들어와요.",
  },
];

export const START_ID = "content";
const { getQuestion, resolveNext } = makeEngine(QUESTIONS, START_ID);
export { getQuestion, resolveNext };

const GUIDE = {
  "source:meeting": { term: "Meeting Notes", title: "회의록 요약 요청", detail: "발언자별 핵심 결정사항과 액션 아이템을 구분해달라고 하면 더 쓸모있어요." },
  "source:article": { term: "Article Digest", title: "아티클 요약 요청", detail: "기사의 핵심 주장과 근거를 중심으로 요약해달라고 요청하세요." },
  "source:report": { term: "Report Summary", title: "보고서 요약 요청", detail: "결론·방법론·수치를 구분해서 요약해달라고 요청하세요." },
  "source:other": { term: "General Summary", title: "일반 요약 요청", detail: "글의 성격에 맞게 핵심을 알아서 판단해 요약해달라고 하세요." },
  "purpose:skim": { term: "Skim Summary", title: "빠른 파악용 요약", detail: "3줄 이내로 핵심만 뽑아달라고 요청하세요." },
  "purpose:share": { term: "Shareable Summary", title: "공유용 요약", detail: "팀원이 맥락 없이 읽어도 이해되게 배경까지 포함해달라고 하세요." },
  "purpose:archive": { term: "Archival Summary", title: "기록용 요약", detail: "나중에 검색하기 쉽게 키워드를 포함해달라고 요청하세요." },
  "format:paragraph": { term: "Prose Format", title: "문단 형식 요청", detail: "줄글 몇 문장으로 자연스럽게 이어서 정리해달라고 요청하세요." },
  "format:bullets": { term: "Bullet Format", title: "불릿 형식 요청", detail: "항목별로 줄바꿈된 불릿포인트로 정리해달라고 요청하세요." },
  "format:table": { term: "Table Format", title: "표 형식 요청", detail: "항목·내용을 표로 정리해달라고 요청하세요." },
};
export const buildGuide = makeGuideBuilder(QUESTIONS, GUIDE);

const SOURCE_LABEL = { meeting: "회의록", article: "아티클", report: "보고서", other: "글" };
const PURPOSE_LABEL = { skim: "핵심만 빠르게 파악하기 위한 용도", share: "팀원·상사에게 공유하기 위한 용도", archive: "나중에 다시 찾아볼 기록용" };
const FORMAT_LABEL = { paragraph: "짧은 문단 몇 줄", bullets: "불릿포인트 목록", table: "표" };

export function buildPrompt(answers) {
  const a = answers || {};
  const lines = [`다음 ${SOURCE_LABEL[a.source] || "글"}을(를) 요약해줘.`, "", "[원문]", (a.content || "").trim(), ""];
  lines.push(`- 목적: ${PURPOSE_LABEL[a.purpose] || PURPOSE_LABEL.skim}`);
  lines.push(`- 형식: ${FORMAT_LABEL[a.format] || FORMAT_LABEL.bullets}`);
  lines.push("", "핵심 내용만 빠짐없이 담아서, 원문에 없는 내용은 추가하지 말고 정리해줘.");
  return lines.join("\n");
}
