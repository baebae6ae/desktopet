/**
 * cat-image.js — "이미지 생성" 카테고리 (Midjourney·DALL-E·이미지 생성 AI용 프롬프트).
 */
import { makeEngine, makeGuideBuilder } from "./wizardEngine.js";

export const id = "image";
export const label = "이미지 생성";
export const icon = "🎨";
export const desc = "그림 · 이미지를 만들고 싶어요";

export const QUESTIONS = [
  {
    id: "subject",
    type: "text",
    title: "어떤 이미지를 만들고 싶으신가요?",
    hint: "눈에 보이는 대로 자유롭게 적어주세요.",
    placeholder: "예) 노을 지는 바다 위를 나는 고양이",
    required: true,
    next: "style",
  },
  {
    id: "style",
    type: "single",
    title: "어떤 그림 스타일로 할까요?",
    options: [
      { value: "photo", label: "사진처럼 사실적으로", next: "mood" },
      { value: "anime", label: "애니메이션 · 일러스트풍", next: "mood" },
      { value: "painting", label: "유화 · 수채화 같은 명화풍", next: "mood" },
      { value: "3d", label: "3D 렌더링", next: "mood" },
      { value: "vector", label: "미니멀한 벡터 아트", next: "mood" },
    ],
    recommend: "anime",
    recommendReason: "가장 무난하게 예쁜 결과가 나오는 스타일이에요.",
  },
  {
    id: "mood",
    type: "single",
    title: "분위기는요?",
    options: [
      { value: "bright", label: "밝고 화사하게", next: "ratio" },
      { value: "dreamy", label: "몽환적이고 신비롭게", next: "ratio" },
      { value: "dark", label: "어둡고 진지하게", next: "ratio" },
      { value: "cozy", label: "따뜻하고 아늑하게", next: "ratio" },
    ],
    recommend: "bright",
    recommendReason: "밝은 분위기가 대부분의 용도에 무난해요.",
  },
  {
    id: "ratio",
    type: "single",
    title: "이미지 비율은요?",
    options: [
      { value: "square", label: "정사각형", desc: "1:1", next: null },
      { value: "wide", label: "가로형", desc: "16:9", next: null },
      { value: "tall", label: "세로형", desc: "9:16", next: null },
    ],
    recommend: "square",
    recommendReason: "1:1이 가장 범용적으로 쓰기 좋아요.",
  },
];

export const START_ID = "subject";
const { getQuestion, resolveNext } = makeEngine(QUESTIONS, START_ID);
export { getQuestion, resolveNext };

const GUIDE = {
  "style:photo": { term: "Photorealistic", title: "사실적 화풍 지정", detail: "실사 사진처럼 보이도록 렌즈·조명 표현까지 요청하면 더 정교해져요." },
  "style:anime": { term: "Anime/Illustration", title: "애니메이션풍 지정", detail: "일러스트/애니메이션 스타일임을 명시하면 선화와 채색 느낌이 살아요." },
  "style:painting": { term: "Painterly", title: "명화풍 지정", detail: "유화·수채화 붓터치 느낌을 요청하면 회화적인 질감이 나와요." },
  "style:3d": { term: "3D Render", title: "3D 렌더링 지정", detail: "3D 렌더 스타일임을 명시하면 입체감과 조명 표현이 강조돼요." },
  "style:vector": { term: "Vector Art", title: "벡터 아트 지정", detail: "플랫하고 미니멀한 벡터 스타일을 요청하면 아이콘·로고에도 잘 어울려요." },
  "mood:bright": { term: "Bright & Vivid", title: "밝은 색감 지정", detail: "채도 높고 화사한 색감을 요청하세요." },
  "mood:dreamy": { term: "Dreamy/Ethereal", title: "몽환적 분위기 지정", detail: "부드러운 빛번짐과 파스텔톤을 요청하면 신비로운 느낌이 살아요." },
  "mood:dark": { term: "Dark/Moody", title: "어두운 톤 지정", detail: "저채도·강한 명암 대비를 요청하면 진지한 무드가 나와요." },
  "mood:cozy": { term: "Warm & Cozy", title: "따뜻한 색감 지정", detail: "따뜻한 색온도와 부드러운 조명을 요청하세요." },
  "ratio:square": { term: "1:1 Aspect", title: "정사각형 비율 지정", detail: "프로필/썸네일 등 범용으로 쓰기 좋은 비율이에요." },
  "ratio:wide": { term: "16:9 Aspect", title: "가로 비율 지정", detail: "배경화면·배너 등에 적합한 와이드 비율이에요." },
  "ratio:tall": { term: "9:16 Aspect", title: "세로 비율 지정", detail: "모바일 화면·스토리 등에 적합한 세로 비율이에요." },
};
export const buildGuide = makeGuideBuilder(QUESTIONS, GUIDE);

const STYLE_LABEL = { photo: "사진처럼 사실적인 스타일", anime: "애니메이션 · 일러스트 스타일", painting: "유화 · 수채화 같은 명화풍", "3d": "3D 렌더링 스타일", vector: "미니멀한 벡터 아트 스타일" };
const MOOD_LABEL = { bright: "밝고 화사한 분위기", dreamy: "몽환적이고 신비로운 분위기", dark: "어둡고 진지한 분위기", cozy: "따뜻하고 아늑한 분위기" };
const RATIO_LABEL = { square: "정사각형(1:1)", wide: "가로형(16:9)", tall: "세로형(9:16)" };

export function buildPrompt(answers) {
  const a = answers || {};
  const lines = [(a.subject || "").trim(), "", `스타일: ${STYLE_LABEL[a.style] || STYLE_LABEL.anime}`, `분위기: ${MOOD_LABEL[a.mood] || MOOD_LABEL.bright}`, `이미지 비율: ${RATIO_LABEL[a.ratio] || RATIO_LABEL.square}`];
  lines.push("", "위 설명에 맞는 고품질 이미지를 생성해줘. 디테일하고 조화로운 색감으로 표현해줘.");
  return lines.join("\n");
}
