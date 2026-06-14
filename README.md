# <img width="40" height="40" alt="Lin-K-transparent" src="https://github.com/user-attachments/assets/b12b2189-4593-4be5-83d8-5bc66423ec79" />  Lin-K 


> 외국인 관광객을 위한 **AI 맞춤 관광 경로 추천 + 실시간 재난 안전 통합** 웹 서비스

<p align="center">
  <a href="https://lin-k.site/"><b>🔗 서비스 바로가기 (lin-k.site)</b></a>
</p>
<p align="center">
  <a href="https://www.youtube.com/watch?v=gitc2EZzw1U"><b>🔗 시연영상 바로가기 (youtube)</b></a>
</p>

**팀명**: Domino-04  
**팀장**: 고태현  
**팀원**: 장효준, 정덕원, 차정민

![React](https://img.shields.io/badge/React-19-61DAFB?logo=react&logoColor=white)
![TypeScript](https://img.shields.io/badge/TypeScript-6.0-3178C6?logo=typescript&logoColor=white)
![Vite](https://img.shields.io/badge/Vite-8.0-646CFF?logo=vite&logoColor=white)
![FastAPI](https://img.shields.io/badge/FastAPI-009688?logo=fastapi&logoColor=white)
![Express](https://img.shields.io/badge/Express.js-000000?logo=express&logoColor=white)
![PyTorch](https://img.shields.io/badge/PyTorch-EE4C2C?logo=pytorch&logoColor=white)
![MySQL](https://img.shields.io/badge/MySQL-8.0-4479A1?logo=mysql&logoColor=white)
![Redis](https://img.shields.io/badge/Redis-7.2-DC382D?logo=redis&logoColor=white)
![Docker](https://img.shields.io/badge/Docker-2496ED?logo=docker&logoColor=white)

---

## 📑 목차

1. [프로젝트 소개](#-프로젝트-소개)
2. [해결하려는 문제](#-해결하려는-문제)
3. [핵심 기능](#-핵심-기능)
4. [기술 스택](#-기술-스택)
5. [시스템 아키텍처](#-시스템-아키텍처)
6. [AI 경로 추천 엔진 상세](#-ai-경로-추천-엔진-상세)
7. [실시간 재난 파이프라인 상세](#-실시간-재난-파이프라인-상세)
8. [프론트엔드 구조](#-프론트엔드-구조)
9. [API 엔드포인트](#-api-엔드포인트)
10. [트러블슈팅](#-트러블슈팅)
11. [차별화 포인트](#-차별화-포인트)
12. [한계 & 향후 계획](#-한계--향후-계획)
13. [팀 구성](#-팀-구성)

---

## 🧭 프로젝트 소개

**Lin-K**는 외국인 관광객이 한국 여행에서 겪는 **언어 · 동선 · 안전** 세 가지 장벽을 한 번에 해결하는 통합 웹 서비스입니다.

단순히 장소를 검색해 최단 경로를 보여주는 기존 지도 앱과 달리, Lin-K는 **성격이 다른 4개의 관광 코스를 AI가 자동 생성**하고, **실시간 재난 정보를 사용자의 경로에 직접 반영**해 위험 구역을 자동으로 우회합니다.

> 정보는 분명히 존재한다. 다만, **외국인이 쉽게 사용할 수 없을 뿐.**

| 항목 | 기존 지도·여행 서비스<br>(카카오맵·구글맵스·네이버지도) | **Lin-K** |
|---|---|---|
| **동선이 의도에 맞는가** | 사용자가 직접 장소 선택, 최단 경로만 제공 | **성격 다른 4코스 동선 추천** |
| **코스 선택·피드백** | 불가능 | **코스 선택만으로 자동 학습** |
| **재난 발생 시 동선 갱신** | 고려·갱신하지 않음 | **경로에 자동 반영 · 우회** |

---

## 🚧 해결하려는 문제

외국인 관광객의 **3대 진입 장벽**:

| | 장벽 | 내용 |
|---|---|---|
| 🈂️ | **언어** | 다국어 정보 부족, 이해하기 어려운 한국어 재난문자, 낮은 다운로드 수의 공식 안전 앱 |
| 🧭 | **동선** | 외국어 리뷰는 결국 외국인이 작성 → 한국에서만 느낄 수 있는 것을 알기 어려움 |
| 🛡️ | **안전** | 재난·혼잡 정보가 '내 경로'에 닿는지 판단할 수 없음 |

기존 카카오맵·구글맵 등은 경로에 재난 정보를 실시간 반영하지 않습니다. 재난문자는 수신되지만 그것이 내 경로와 얼마나 겹치는지, 우회해야 하는지 알 수 없고, 외국인은 한국어 재난문자 자체를 읽지 못합니다. Lin-K는 서울시 실시간 도시데이터/행정안전부 API와 카카오 길찾기 API 사이에 **안전 판정 레이어**를 추가해 이 문제를 해결합니다.

---

## ✨ 핵심 기능

### 1️⃣ AI 기반 맞춤 경로 추천

한 번의 요청으로 **성격이 다른 4개 코스**를 생성합니다.

<img width="400" height="251" alt="KakaoTalk_20260612_080342358_05" src="https://github.com/user-attachments/assets/017a965e-d3be-4edd-be21-37b2c80e50bc" /> <img width="400" height="251" alt="KakaoTalk_20260612_080342358_06" src="https://github.com/user-attachments/assets/8bdd0507-e73c-471b-9ef9-a74ec7754545" />

| 코스 | 성격 | 가중치 방식 |
|---|---|---|
| 🏛️ **명소 탐방 (A)** | 평점 높은 명소·문화 중심 | 개발자 고정 가중치 |
| 🍜 **맛집 투어 (B)** | 식당·카페 중심 | 개발자 고정 가중치 |
| 🕐 **반나절 코스 (C)** | 카테고리 다양성 + 거리 효율 | 개발자 고정 가중치 |
| ⭐ **맞춤 코스** | 사용자 선택 이력 기반 개인화 | EMA 동적 가중치 |

- 카카오 카테고리 검색(명소·문화·카페·공원·식당)으로 주변 장소 수집 → **TripAdvisor 평점**으로 보강
- 부적절 업종(주차장·은행·편의점 등) **블랙리스트 이중 필터링** + 활성 재난 구역 내 장소 자동 제외
- 코스별 독립 **MLP(PyTorch) 3종**으로 장소 점수화 (코스마다 다른 판단 기준 학습)
- **Dijkstra + Held-Karp(DP) + 2-opt**로 방문 순서를 최단 동선으로 최적화
- 코스 선택 시 선택/미선택 장소를 positive/negative로 **BCE + Adam 온라인 학습** → 가중치 즉시 갱신
- 카테고리 선호도는 **EMA(지수이동평균)** 가중치로 누적 갱신 → 사용할수록 정확도 상승

### 2️⃣ 실시간 재난 안전 파이프라인

위험이 생기면 스스로 피해가는 경로 → 경로에 실시간 안전 상태를 반영합니다.

<img width="400" height="251" alt="KakaoTalk_20260612_080342358_01" src="https://github.com/user-attachments/assets/6936dc5c-9de1-4049-b125-b3d721dad8d5" />

- 서울시 실시간 도시데이터 / 행정안전부 긴급재난문자 API **주기적 폴링** → 신규 재난 감지 (SHA-256 중복 제거)
- **Gemini 2.5 Flash**로 재난문자 원문에서 위경도·위험 반경 추출 → 서울 범위 검증(실패 시 최대 3회 재시도) → DB 저장
- 활성 재난과 카카오 Directions 경로의 **교차 여부를 Haversine으로 판정**해 위험 패널티 산출
- 출발 전 경로 안전 검사 → 안내 중 실시간 감지 → **자동 우회 코스 재계산**까지 end-to-end 연결
- 재난 알림 배너, 위험도 칩, 지도 위 재난 구역 오버레이로 시각화

### 3️⃣ 주변 탐색

현위치 기반으로 주변 관광 장소를 카테고리별로 탐색합니다.  

<img width="400" height="251" alt="KakaoTalk_20260612_080342358_02" src="https://github.com/user-attachments/assets/f331e971-b891-4d7a-8818-eb1e8aa16ca6" />

- 카카오 **카테고리 검색 5종 병렬** (명소 AT4 · 문화 CT1 · 카페 CE7 · 식당 FD6 · 공원 PK6)
- 관광과 무관한 시설(주차장·은행·편의점·병원 등) **블랙리스트 필터링** (백엔드와 동일 기준)
- 활성 **재난 구역 내 장소 자동 제외** + 카테고리 균등 샘플링
- **TripAdvisor 평점 보강** (5개씩 배치, 300ms 간격으로 rate limit 대응)
- 반경별 최대 결과 수 조절 (250m→10개 / 500m→20개 / 1,000m→30개)
- 지도 위 **카테고리별 색상 핀** + 선택 시 평점 lazy fetch, 사이드바 목록 카드 연동

### 4️⃣ 장소 검색

지도와 연동된 키워드 검색으로 출발지·도착지를 지정합니다.

<img width="400" height="251" alt="KakaoTalk_20260612_080342358" src="https://github.com/user-attachments/assets/d605437a-3f43-46fb-8184-1e082cac9667" /><img width="400" height="251" alt="KakaoTalk_20260612_080342358_05" src="https://github.com/user-attachments/assets/8fc788dd-270c-47df-8a78-967608f2603b" />


- 카카오 키워드 검색 + **300ms 디바운싱**으로 불필요한 요청 최소화
- 검색 결과 상위 10개에 **TripAdvisor 평점 비동기 연동** (localStorage 7일 캐시 우선)
- **2단계 선택 흐름**: 1번째 클릭 → 지도 중심 이동(미리보기), 2번째 클릭 → 실제 확정
- 검색 결과를 지도 위 핀으로 표시, 확정 시 일반 핀 → 확정 마커로 교체
- 현재 위치 버튼 · 출발↔도착 swap 시 입력창 자동 갱신 (`overrideQuery`로 불필요한 재검색 방지)

---

## 🛠 기술 스택

### Frontend
| 항목 | 내용 |
|---|---|
| 프레임워크 | React 19 |
| 언어 | TypeScript 6.0 (ES2023 타겟) |
| 빌드 도구 | Vite 8.0 |
| 패키지 매니저 | npm |
| 코드 품질 | ESLint + TypeScript-ESLint |
| 규모 | 약 30개 파일 / 12개 컴포넌트 / 4개 커스텀 훅 / 약 7,000+ 라인 |

### Backend
| 항목 | 내용 |
|---|---|
| API 서버 | FastAPI (Python) — 핵심 비즈니스 로직 |
| 게이트웨이 | Express.js (Node.js) — 클라이언트 인증·카카오 연동 |
| DB | MySQL 8.0 (GEOMETRY + SPATIAL INDEX) |
| 캐시 | Redis 7.2 (인메모리 캐싱) |
| 인프라 | Docker Compose (4개 컨테이너) |

### AI / 외부 API
| API | 용도 |
|---|---|
| PyTorch | 경로 추천 MLP (코스별 A/B/C 모델) |
| Gemini 2.5 Flash | 재난문자 위경도·반경 추출 |
| Kakao Maps SDK | 지도 렌더링, 카테고리/키워드 검색, 지오코딩 |
| Kakao Directions | 차량 경로 계산 (거리·시간·요금·폴리라인) |
| TripAdvisor Content API | 장소 평점·리뷰 수·웹 URL |
| SK T-map | 보행자 도보 경로 계산 |
| Google OAuth 2.0 | 사용자 로그인 |

---

## 🏗 시스템 아키텍처

### Docker Compose 구성

<img width="2350" height="1600" alt="architecture" src="https://github.com/user-attachments/assets/20060a27-dc95-41e4-8558-216a32982792" />


| 컨테이너 | 역할 | 선택 이유 |
|---|---|---|
| **MySQL 8.0** | 재난 공간 데이터 영구 저장 | GEOMETRY 타입 + SPATIAL INDEX 지원 |
| **Redis 7.2** | 실시간 도시데이터 인메모리 캐싱 | 폴링 주기와 TTL을 맞춰 DB I/O 최소화 |
| **FastAPI** | 핵심 비즈니스 로직 | Python 생태계(Gemini SDK, GeoAlchemy2) |
| **Express.js** | 클라이언트 API 게이트웨이 | 기존 Firebase·카카오 연동이 Node.js 기반 |

### 전체 데이터 흐름

```
[서울시 / 행정안전부 API]
        │  주기적 폴링 (Semaphore 동시성 제어)
        ▼
[FastAPI 서버]
  ├─ EventDetector  → SHA-256 중복 제거
  ├─ Gemini LLM     → 위경도 + 반경 추출 → 서울 범위 검증
  └─ MySQL INSERT   → 재난 이력 영구 저장
        │
        ▼
[클라이언트] → 카카오 경로 요청 → 안전 판정 요청 → 위험/우회 알림
```

---

## 🤖 AI 경로 추천 엔진 상세

> `routemodel.py` 기반 · "어떤 장소가 좋은가(MLP)" + "어떤 순서로(TSP)" + "어떤 카테고리를 우선(가중치)" 세 문제를 동시 해결

### 신경망 모델 — 코스별 3개 MLP 분리

명소 탐방의 "좋은 장소"와 맛집 투어의 "좋은 장소"는 기준이 충돌하므로, **A/B/C 코스마다 독립된 MLP**를 둡니다.

- **Multi-Branch Architecture**: 평점·리뷰·수상·영업 상태를 각자 전용 레이어에서 의미 추출 후 결합 (특성 간 스케일 차이 보정)
- 평점 레이어에 더 많은 뉴런 할당 (A코스 16 vs C코스 8) → 명소 코스는 평점에 더 민감
- 최종 출력은 **Sigmoid**로 0~1 고정 (이후 다른 수치와 곱해지므로 범위 안정성 필수)

### 특성 추출 (5~6차원)

| # | 특성 | 변환 | 이유 |
|---|---|---|---|
| ① | 평점 | `rating / 5.0` | 0~1 정규화 (피처 스케일링) |
| ② | 리뷰 수 | `log10(reviews+1) / 5.0` | 100개 vs 1만개 격차 완화 (로그 변환) |
| ③ | 리뷰 품질 | 4·5점 비율 | 평균이 못 잡는 분포 안정성 측정 |
| ④ | 수상 이력 | `min(len, 10) / 10.0` | 이상값(outlier) 상한선 |
| ⑤ | 영업 상태 | `True:1.0 / None:0.5 / False:0.0` | 정보 부재를 결핍으로 오해 방지 |
| ⑥ | 거리(B코스) | `min(dist, 5000) / 5000` | 도보 한계 거리 반영 |

### 최종 점수 공식

```python
final_score = (nn_quality × rating_score × cat_weight) + (award_count × 0.5)
```

- **곱셈부** `nn_quality × rating_score × cat_weight`: 세 기준(신경망 판단·검증된 인기·코스 적합성)이 **모두** 충족돼야 높은 점수 → "하나라도 낮으면 전체가 낮아지는" 엄격한 기준
- **덧셈부** `award_count × 0.5`: 수상 이력은 독립적 품질 보증 → 다른 점수가 0이어도 살아남는 베이스라인

### 카테고리 가중치 vs `.pt` 가중치

| | 카테고리 가중치 (`_W_SIGHT` 등) | `.pt` 파일 가중치 |
|---|---|---|
| 누가 정했나 | 개발자가 직접 설정 | 학습(역전파)으로 자동 조정 |
| 무엇을 판단 | "이 코스에서 이 카테고리가 중요한가" | "특성을 어떻게 조합하면 좋은 장소인가" |
| 바뀌는가 | A/B/C 고정, 맞춤 코스는 EMA 갱신 | 사용자 피드백 때마다 변경 |

> 비유: `.pt` = 심사위원의 미각(경험으로 개선), 카테고리 가중치 = 심사 규칙(대회 성격에 따라 고정)

### TSP 최적화 — Dijkstra + Held-Karp + 2-opt

1. **Dijkstra**: 모든 장소 쌍의 최단 거리를 사전 계산해 딕셔너리에 저장 (카카오 API 호출 비용 절감)
2. **Held-Karp (비트마스크 DP)**: 브루트포스 대비 확장성 확보 (n=10에서 35배 빠름) → 장소 수 확장 대비
3. **2-opt 후처리**: 유클리드 기반 최적해의 시각적 교차를 제거 (추천 탭은 순환형, 직접 입력은 양 끝 고정)

### 온라인 피드백 학습

- **BCE Loss + Adam (lr=0.005, 15 step)**: 소수 샘플(15~30개)에서도 안정적 학습
- `threading.Lock()`으로 동시 피드백 직렬화 (race condition 방지)
- A/B/C 3개 모델에 모두 같은 피드백 → "좋은 장소 구별 공통 기반" 공유, 코스별 특화는 카테고리 가중치 담당
- 맞춤 코스는 `category_weights.json` EMA 갱신(선택 +5% / 미선택 -1.5%)으로 개인화

---

## 🚨 실시간 재난 파이프라인 상세

### 백그라운드 폴링 스케줄러 (`scheduler.py`)

- FastAPI `lifespan` 훅으로 서버 기동 시 폴링 시작, 핫스팟을 주기적으로 순회
- **Exponential Backoff**: 연속 실패 시 대기 시간 2배씩 증가(최대 30분) → 서울시 API 다운 시 무한 재시도 방지
- **`asyncio.Semaphore(10)`**: 동시 HTTP 연결 10개 제한 (25개 동시 호출 시 rate limit 발생 확인)
- **날씨 최적화**: Redis TTL 1시간, 캐시 히트 시 SET 생략 (이론적 히트율 ≈ 91.7%)

### 이벤트 감지 + 중복 제거 (`event_detector.py`)

- 재난문자 내용 + 생성 시각을 **SHA-256 해시** → 같은 재난은 항상 동일한 16자리 ID
- 메모리 `set`으로 중복 차단, 서버 재시작 시 DB에서 최근 24시간 `event_id` 복원

### Gemini LLM 위경도 추출 (`disaster_service.py`)

- 프롬프트를 **의도적으로 영어로 작성** → 한국어 입력을 영어 지시문으로 분석 시 정확도 상승 확인
- 응답 방어: 마크다운 코드 블록(` ```json `) 제거 후 파싱
- **서울 바운딩 박스 검증** + 검증 실패 시 최대 3회 재시도
- 반경 크기별 패널티 산정 (긴급재난 100 / 교통통제 60 / 호우 30)

### 경로 안전 판정 엔진 (`route.py`)

- **Haversine 공식**으로 경로 꼭짓점과 재난 중심 간 거리 계산 (지구 곡면 고려)
- **꼭짓점 샘플링**: 3개 중 1개만 검사해 CPU 66% 절감
- `radius + 50m` 버퍼 이내면 위험 판정 (아슬하게 피해도 경고)
- 반환: `is_safe`, `total_penalty`, `affected_sections`, `disaster_warnings`

### Redis 캐싱 전략 (`cache.py`)

키 접두어(prefix)에 따라 TTL 자동 결정:

| Prefix | TTL | 비고 |
|---|---|---|
| `disaster:` `accident:` | 영구(None) | 재난 이력 보존 → "최근 재난 조회" 가능 |
| `traffic:` `population` | 300초 | 폴링 주기와 동일 |
| `weather:` | 3600초 | 1시간 |
| `event:` | 86400초 | 24시간 |

---

## 🎨 프론트엔드 구조

> React 19 + TypeScript + Vite · 헤드리스 컴포넌트로 지도 오버레이 관리

### 주요 컴포넌트 (12개)

| 컴포넌트 | 역할 |
|---|---|
| `RouteScreen.tsx` | 루트 화면 (좌우 분할 레이아웃, 재난 모달 관리) · 1,265줄 |
| `RoutePanel.tsx` | 경로 탐색 패널 (추천 경로 + 직접 입력) · 1,331줄 |
| `NearByMap.tsx` | 주변 탐색 지도 오버레이 (반경 원 + 마커) |
| `PlaceMarker.tsx` / `PlaceCard.tsx` | 카카오맵 장소 핀 / 목록 카드 |
| `PlaceSearchInput.tsx` | 카카오 장소 검색 입력 (2단계 선택) |
| `DisasterAlertBanner.tsx` | 재난 알림 토스트 배너 |
| `DisasterStatusChip.tsx` | 재난 현황 플로팅 배지 + 이력 시트 |
| `DisasterZoneOverlay.tsx` | 지도 위험 구역 원형 오버레이 (헤드리스) |
| `RouteMap.tsx` / `SplashScreen.tsx` | 경로 폴리라인 렌더러 / 초기 로딩 화면 |

### 커스텀 훅 (4개)

| 훅 | 역할 |
|---|---|
| `useKakaoNearby` | 카카오 카테고리 검색 + TripAdvisor 평점 보강 |
| `useRecommendedRoute` | ML 기반 추천 경로 생성 + 피드백 전송 |
| `useDisasterAlert` | 재난 알림 큐(FIFO, max 10) + 타임아웃 관리 |
| `usePlaceSearch` | 카카오 장소 검색 디바운싱 (300ms) |

### 주요 흐름 포인트

- **다층 캐싱**: 세션 캐시(주변 탐색) + localStorage 7일 캐시(평점) + 배치 처리(5req/s, 300ms 간격)
- **재난 구역 활성 시 캐시 무효화** → 안전도 우선
- **categoryBias(5x)**: 안내 중 우회 재계산 시 기존 코스 성격 유지
- **이동 수단별 API**: 차량(카카오 Directions) / 도보(T-map) / 대중교통(미연결)
- **재난 모달 분기**: 출발지만 구역 내 → 바로 안내 / 도착지 구역 내 → 경고 모달 / 경로 본체 통과 → 우회 선택 모달

---

## 🔌 API 엔드포인트

### 재난 관련 (`/disaster`)

| Method | Path | 설명 |
|---|---|---|
| GET | `/disaster/active` | 현재 만료되지 않은 재난 알림 전체 조회 |
| GET | `/disaster/nearby` | 특정 좌표 주변 활성 재난 조회 |
| POST | `/disaster/analyze` | 재난문자를 Gemini로 분석해 위경도·반경 추출 |
| POST | `/disaster/simulate` | 재난 시나리오 직접 주입 (데모·테스트용) |
| POST | `/disaster/fetch-and-save` | 서울시 API에서 최신 알림 가져와 저장 |

### 경로 관련 (`/route`)

| Method | Path | 설명 |
|---|---|---|
| POST | `/route/calculate` | 카카오 경로 데이터로 안전 판정 (is_safe, penalty) |
| POST | `/route/recommend` | ML 기반 4개 코스 추천 |
| POST | `/route/recommend/feedback` | MLP 온라인 학습 피드백 |
| POST | `/route/feedback` | 카테고리 가중치 EMA 갱신 |

### 캐시·모니터링

| Method | Path | 설명 |
|---|---|---|
| GET | `/cache/metrics` | Redis 히트율, 날씨 최적화 수치, 스케줄러 상태 |
| GET | `/health` | 서버 상태, 누적 API 호출 수, 감지 이벤트 수 |

---

## 🐛 트러블슈팅

| 문제 | 해결 |
|---|---|
| 추천에 부적절한 장소(주차장·편의점 등) 포함 | 정확/부분 일치 블랙리스트 이중 필터링 |
| 재난 구역 회피 시 추천 장소 수 부족 | `extra_places` 예비 풀에서 평점순 자동 보충 |
| 서버 재시작 시 중복 알림 발생 | 기동 시 DB에서 최근 24시간 `event_id` 복원 |
| Held-Karp 지수 시간(2ⁿ) | 비트마스크 상태 압축 DP + 후보 수 제한 |
| Gemini 좌표 신뢰성 | 바운딩 박스 검증 + 재시도 최대 3회 |
| Gemini 응답 비결정성 (마크다운 래핑) | ` ```json ` 제거 방어 코드 |
| MySQL SRID 4326 좌표 역전 | `ST_X=위도 / ST_Y=경도` 표준에 맞게 수정 |
| `.gitignore` 연쇄 장애 (config.json 제외) | `!**/config.json` 예외 추가 + gitignore 통합 |
| ORM 모델 ↔ 실제 테이블 스키마 불일치 | 존재하는 컬럼만 사용하도록 INSERT 수정 |
| `hit_rate` 단위 혼용 (1.0 → 1.0%) | `hit_rate_pct`로 백분율 직접 반환 |

---

## 🌟 차별화 포인트

1. **TripAdvisor 평점 통합** — 카카오맵에 없는 평점을 추천 ML 입력·주변 탐색·검색 결과 세 곳에 모두 반영
2. **재난 연동 경로 우회** — 단순 알림을 넘어 출발 전 검사 → 실시간 감지 → 자동 우회까지 end-to-end 연결, 기존 코스 성격을 유지하는 카테고리 편향(5x) 적용
3. **ML 온라인 학습** — 코스 선택이 MLP 가중치(`.pt`)와 카테고리 EMA(`.json`) 두 시스템에 즉시 반영, 서버 재시작 없이 다음 추천부터 개인화
4. **다층 캐싱 전략** — 세션 캐시 + localStorage 7일 캐시 + 배치 처리로 TripAdvisor rate limit 대응, 재난 활성 시 캐시 무효화로 안전도 유지

---

## 🔭 한계 & 향후 계획

| 항목 | 현황 |
|---|---|
| **전국·다도시 확대** | 현재 서울 핫스팟 중심 → 전국 확대 |
| **휴리스틱 병행** | Held-Karp 장소 수 확장성 보완 |
| **푸시 알림 완성** | 사용자에게 직접 알림 전송 |
| **대중교통 경로** | T-map transit 키 별도 발급 필요 |
| **추천 경로 차량** | 폴리라인 꼬임 현상 개선 필요 |
| **즐겨찾기 기능** | `useFavorites` 미구현, 로그인 계정 기반 분리 저장 미완성 |

---

## 👥 팀 구성

**팀 Domino-04**

| 이름 | 담당 |
|---|---|
| **고태현** | 프론트엔드 UI, 경로 추천 모델(MLP·TSP) 설계, 실시간 재난 안전 파이프라인 구현, 서비스 배포 |
| **장효준** | 프론트엔드 UI, 동적 반응형 가이드 |
| **정덕원** | 동적 반응형 가이드, FastAPI 백엔드 (폴링·Gemini·안전 판정·캐싱) |
| **차정민** | 동적 반응형 가이드, LLM·API 연동, 실시간 도시데이터 |

---

<p align="center">
  <b>효율성 대신 새로움, 사용자의 안전을 위한 서비스 — 팀 Domino-04</b>
</p>
