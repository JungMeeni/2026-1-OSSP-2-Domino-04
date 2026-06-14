# 경로 추천 모델(routemodel.py) 참고

## 0. 모델의 목표

이 모델은 두 가지 문제를 동시에 풀어야 합니다.

**문제 1: 어떤 장소가 좋은 장소인가?** → 신경망(MLP)으로 해결 - **`품질 평가`**
**문제 2: 선택된 장소들을 어떤 순서로 방문하면 가장 효율적인가?** → TSP 알고리즘으로 해결 - **`순서 최적화`**

**문제 3: 어떤 카테고리의 장소를 이 코스에서 우선해야 하는가?** → 코스 유형별 고정 가중치 + 사용자 이력 기반 EMA 학습으로 해결 — **코스 적합성 판단**

**A(명소 탐방) / B(맛집 투어) / C(반나절 코스)**는 **`개발자가 직접 설정한 고정 가중치로 성격을 정의`**하고, **맞춤 코스(**⭐**)** 는 사**`용자가 코스를 선택할 때마다 갱신되는 EMA 가중치`**로 개인화된 성격을 가집니다.

---

## 1. 블랙리스트 필터링 — 2 종류로 나누게 된 이유

```jsx
_EXACT_BLACKLIST: set[str] = {
    "주차장", "파킹", "ATM", "편의점", "GS25", ...
}
_SUBSTR_BLACKLIST: list[str] = [
    "저축은행", "농협", "신한은행", "한의원", "치과", ...
]
```

routemodel.py:144-181

### 두 종류로 나눈 이유

**`_EXACT_BLACKLIST` (정확 매칭):** "주차장"이라는 단어가 이름에 포함되면 무조건 제거합니다. 이 키워드들은 **단독으로 쓰여도 명확히 관광 부적합**입니다.

**`_SUBSTR_BLACKLIST` (부분 매칭):** "신한은행 서울역지점"처럼 은행명이 이름 일부에 포함된 경우를 잡기 위해 사용합니다. 은행, 병원, 부동산은 지점명이 다양하기 때문에 정확 매칭만으로는 걸러낼 수 없습니다.

> **왜 두 종류를 구분하나요?** 오탐(false positive) 방지입니다. 예를 들어 "CU편의점"은 substring 리스트에 있지만, 만약 "CU"만 exact 리스트에 넣었다면 "CU아트홀" 같은 문화시설도 걸러질 수 있습니다. 키워드가 구체적일수록 exact에, 포괄적인 패턴은 substring에 넣는 전략입니다
> 

---

## 2. 재난 구역 필터링

### 모델이 담당하는 것: "재난 구역 안의 장소를 후보에서 제거"

경로 추천 모델은 "도로가 재난 구역을 통과하는가"를 판단하지 않습니다. 그 대신 **재난 구역 안에 위치한 장소 자체를 추천 후보에서 아예 제거**합니다. 재난 지역 근처에 갈 일 자체를 만들지 않는 방식입니다.

---

### 구체적인 구현

### ① 재난 구역 데이터 구조

```jsx
class DisasterZone(BaseModel):
    lat:      float
    lng:      float
    radius_m: float = 2000.0   # 기본 반경 2km
```

routemodel.py:86-91

재난 구역을 **원형**으로 표현합니다. 중심 좌표(위도/경도)와 반경(미터)으로 정의됩니다. 기본값이 2km인 이유는 재난 문자가 발송되는 영향 반경이 보통 1~3km 수준이기 때문입니다.

---

### ② 장소가 구역 안에 있는지 판별

```jsx
def is_in_any_disaster_zone(place, zones) -> bool:
    return any(
        _haversine_m(place.lat, place.lng, z.lat, z.lng) < z.radius_m
        for z in zones
    )
```

routemodel.py:195-200

장소의 좌표와 재난 구역 중심 좌표 사이의 거리를 **Haversine 공식**으로 계산합니다. 이 거리가 반경보다 짧으면 "구역 안에 있다"고 판단합니다.

**Haversine을 쓰는 이유: 위도/경도는 지구 곡면 위의 좌표입니다. 단순히 좌표 차이를 계산하면 오차가 생기기 때문에, 지구가 구형임을 고려한 Haversine 공식으로 실제 지표면 거리를 계산합니다.**

---

### ③ 추천 요청 처리 흐름에서의 적용

```jsx
# 블랙리스트 필터링 후
if req.disaster_zones:
    before_zone = len(filtered)
    filtered = [p for p in filtered
                if not is_in_any_disaster_zone(p, req.disaster_zones)]
    removed_by_zone = before_zone - len(filtered)
```

routemodel.py:851-860

**블랙리스트 필터링 다음 단계로, 재난 구역이 전달된 경우에만 동작합니다.** 재난 구역이 없는 일반 요청은 이 단계를 건너뜁니다.

---

### ④ 제거된 장소를 `extra_places`로 보충

```jsx
if removed_by_zone > 0 and req.extra_places:
    existing_ids = {p.id for p in filtered}
    valid_extras = [
        p for p in req.extra_places
        if not is_blacklisted(p.name)
        and p.id not in existing_ids
        and not is_in_any_disaster_zone(p, req.disaster_zones)
    ]
    valid_extras.sort(key=lambda p: p.rating, reverse=True)
    to_add = valid_extras[:removed_by_zone]
    filtered.extend(to_add)
```

routemodel.py:863-879

재난 구역 때문에 제거된 장소가 있으면, 프론트엔드가 미리 함께 보낸 **`extra_places`**(예비 장소 목록)에서 보충합니다.

보충 기준:

- 블랙리스트에 해당하지 않을 것
- 이미 후보에 있는 장소가 아닐 것
- 보충 장소 자체도 재난 구역 안에 없을 것 (당연한 조건)
- 위 조건을 통과한 것들 중 **평점 높은 순**으로 정렬해서 제거된 수만큼만 추가

이 설계의 핵심은 **"재난이 발생해도 항상 5개 장소를 채운 코스를 반환한다"** 는 것입니다. 장소가 줄어든 채로 2~3개짜리 코스가 나오지 않도록 보충 메커니즘이 설계되어 있습니다.

---

### 모델이 담당하지 않는 것 (프론트엔드 역할)

경로 추천 모델은 **장소 선정** 단계에서만 재난을 처리합니다. 그 이후의 것들, 즉 "선정된 장소들을 잇는 경로(폴리라인)가 재난 구역의 도로를 지나는가"는 프론트엔드가 별도로 판단합니다. 실제 도로 경로는 카카오 Directions API가 생성하기 때문에, 모델 단에서 도로 수준의 우회를 처리하기 어렵기 때문입니다.

역할을 정리하면:

| 담당 | 역할 |
| --- | --- |
| **경로 추천 모델** (routemodel.py) | 재난 구역 안의 **장소** 자체를 후보에서 제거 |
| **프론트엔드** (RouteScreen.tsx) | 생성된 **경로 폴리라인**이 재난 구역을 통과하는지 Haversine으로 확인 후 우회 요청 트리거 |

---

## 3. 신경망 모델 — 3개로 분리하게 된 이유

```jsx
class PlaceScoringNetA(nn.Module):
    """A코스 — 입력 5: [rating, log_reviews, review_quality, awards, open]"""
    def __init__(self):
        self.rating_layer = nn.Sequential(nn.Linear(1, 16), nn.ReLU())
        self.review_layer = nn.Sequential(nn.Linear(2, 8),  nn.ReLU())
        self.award_layer  = nn.Sequential(nn.Linear(1, 8),  nn.ReLU())
        self.open_layer   = nn.Sequential(nn.Linear(1, 8),  nn.ReLU())
        self.merge_layer  = nn.Sequential(
            nn.Linear(40, 16), nn.ReLU(),
            nn.Linear(16, 1),  nn.Sigmoid(),
        )
```

routemodel.py:207-227

### 왜 하나의 모델이 아니라 3개인가?

하나의 모델로 A/B/C 코스를 모두 처리한다고 가정한다면 "명소 탐방에서 좋은 장소"와 "맛집 투어에서 좋은 장소"의 기준이 서로 충돌합니다. 명소 모델은 평점 높은 갤러리를 좋아해야 하고, 맛집 모델은 리뷰 많은 식당을 좋아해야 합니다. 하나의 모델에 이 두 기준을 동시에 학습시키면 어중간한 결과가 나오기 때문에 분리했습니다.

**3개로 분리하면:**

- 각 모델이 자기 코스의 특성에만 집중해서 학습
- 피드백도 코스별로 독립적으로 반영 (B코스를 선택해도 A·C 모델에도 반영되지만, 각 모델이 서로 다른 방향으로 조정 가능)
- 하나의 모델이 오작동해도 나머지 코스에 영향 없음

### 왜 특성마다 별도 레이어를 만들었는가?

```jsx
self.rating_layer = nn.Sequential(nn.Linear(1, 16), nn.ReLU())  # 평점
self.review_layer = nn.Sequential(nn.Linear(2, 8),  nn.ReLU())  # 리뷰수, 품질
self.award_layer  = nn.Sequential(nn.Linear(1, 8),  nn.ReLU())  # 수상이력
```

이것은 **Multi-Branch Architecture(다중 분기 구조)** 라고 합니다. 모든 특성을 한 번에 하나의 레이어에 넣는 것이 아니라, 각 특성이 먼저 자기 전용 레이어에서 의미를 추출한 뒤 나중에 합칩니다.

**이유:** 특성들의 스케일이 너무 다릅니다. **`평점은 0 ~ 5 사이`**이지만, **`리뷰 수는 0 ~ 수만 개`**입니다. 이것을 한 레이어에 섞으면 **숫자가 큰 특성이 학습을 지배**합니다. 각자 분리하면 각 특성의 패턴을 독립적으로 학습할 수 있기 때문에 특성마다 레이어를 분리했습니다.

**평점 레이어가 16개 뉴런, 나머지가 8개인 이유:** **평점은 가장 직접적인 품질 지표**이므로 더 많은 표현력(뉴런)을 할당했습니다. **`8 vs 16이라는 선택`**은 **"평점이 다른 특성보다 2배 더 중요하다"는 설계 의도**를 뜻합니다.

### A(명소탐방) vs C(반나절) 모델 — 같은 입력인데 왜 분리?

```jsx
class PlaceScoringNetA  # 입력 5차원, rating_layer → 16뉴런
class PlaceScoringNetC  # 입력 5차원, rating_layer → 8뉴런
```

routemodel.py:255-275

A코스(명소 탐방)와 C코스(반나절 코스)는 입력 특성은 동일하지만, **학습된 가중치(weights)가 다릅니다.** 같은 특성을 보더라도 "명소 탐방 관점에서의 좋은 장소"와 "반나절 코스 관점에서의 좋은 장소"는 다릅니다. 

**→ 구조가 같아도 별도로 학습시키면 서로 다른 판단 기준을 가지게 됩니다.**

또한 A모델은 `rating_layer`가 16뉴런, C모델은 8뉴런입니다. **A코스는 평점에 훨씬 민감해야 하기 때문**입니다. **명소 탐방 코스는 "가장 좋은 명소"를 뽑아야 하므로** 평점 차이를 더 세밀하게 구분해야 합니다.

### Sigmoid를 최종 출력에 사용하게 된 이유

```jsx
self.merge_layer = nn.Sequential(
    nn.Linear(40, 16), nn.ReLU(),
    nn.Linear(16, 1),  nn.Sigmoid(),  # ← 반드시 0~1 출력
)
```

**Sigmoid 함수는 어떤 숫자든 0과 1 사이로 압축**합니다. **`이 출력값이 나중에 다른 수치들(평점, 카테고리 가중치)과 곱해지기 때문에, 출력 범위를 0~1로 고정하지 않으면 최종 점수가 예측 불가능하게 커지거나 음수가 될 수 있습니다.`**

---

## 4. 특성 추출 후 변환을 진행한 이유

```jsx
def _base_features(place: PlaceInput) -> tuple:
    return (
        place.rating / 5.0,                                    # ① 평점 정규화
        math.log10(place.num_reviews + 1) / 5.0,              # ② 리뷰 수 로그 변환
        _review_quality(place.review_rating_count),            # ③ 고품질 리뷰 비율
        min(len(place.awards), 10) / 10.0,                    # ④ 수상 이력
        {True: 1.0, None: 0.5, False: 0.0}[open_status],     # ⑤ 영업 상태
    )
```

routemodel.py:343-352

---

### ① `place.rating / 5.0` — 왜 5로 나눠?

TripAdvisor **`평점은 0 ~ 5 범위`**입니다. 이것을 **5로 나누면 0 ~ 1 범위가 됩니다.**

**이유:** 신경망은 **모든 입력이 비슷한 스케일일 때** 잘 학습하기 때문입니다. **만약 평점이 0 ~ 5이고 다른 특성이 0 ~ 1이라면, 평점의 변화 1.0이 다른 특성의 변화 1.0보다 5배 크게 느껴집니다.** 이를 **피처 스케일링**이라 하며, 학습 안정성을 위한 필수 처리입니다.

---

### ② `math.log10(place.num_reviews + 1) / 5.0` — 굳이 왜 로그 변환?

리뷰가 100개인 장소와 10,000개인 장소를 단순 수치로 비교하면 격차가 100배입니다. **하지만 관광 품질 관점에서 100개 리뷰와 10,000개 리뷰의 차이가 정말 100배만큼 중요하지는 않다고 생각했습니다.**

**로그 변환의 효과:**

```jsx
리뷰   1개 → log10(2)   ≈ 0.30
리뷰  10개 → log10(11)  ≈ 1.04
리뷰 100개 → log10(101) ≈ 2.00
리뷰 1000개 → log10(1001) ≈ 3.00
리뷰 10000개 → log10(10001) ≈ 4.00
```

리뷰가 10배 늘어날 때마다 점수가 동일하게 1씩 늘어납니다. 즉, "리뷰 0→10개"의 의미와 "리뷰 1000→10000개"의 의미를 동등하게 취급합니다. **이것이 현실에 더 가깝다고 생각했습니다.**

**`+1`을 더하는 이유**: **리뷰가 0개일 때 `log10(0)`은 수학적으로 정의되지 않아(-∞) 에러가 발생하기 때문**입니다.

**마지막에 `/5.0`으로 나누는 이유**: `log10(100001) ≈ 5.0`이므로, **리뷰 10만 개 이상인 장소도 0~1 범위로 맞추기 위해서**입니다.

---

### ③ `_review_quality` — 왜 리뷰 품질 비율을 별도로 계산?

```jsx
def _review_quality(review_rating_count: dict) -> float:
    total = high = 0
    for star, count_str in review_rating_count.items():
        count = int(count_str)
        total += count
        if star in ("4", "5"):
            high += count
    return high / total if total > 0 else 0.0
```

routemodel.py:330-340

**이미 평점 평균이 있는데 굳이 따로 계산하는 이유?**

**→ 평점 4.5가 두 장소에서 같아도 리뷰 분포가 완전히 다를 수 있습니다:**

- 장소 A: 4점 50개 + 5점 50개 → **평점 4.5, 고품질 비율 100%**
- 장소 B: 1점 10개 + 5점 90개 → **평점 4.6, 고품질 비율 90%**

**B의 평점 평균이 오히려 높지만, 1점짜리 나쁜 후기가 10개나 있다는 것은 중요한 정보**입니다. 리뷰 품질 비율은 **"평균 점수"가 잡지 못하는 분포의 안정성을 측정**합니다.

---

### ④ `min(len(place.awards), 10) / 10.0` — 왜 10으로 cap을 걸었는가?

→ 수상 이력이 10개를 넘어도 최대 1.0으로 제한

**이유:** 수상 이력이 10개든 100개든 "매우 유명한 장소"라는 의미는 동일합니다. 100개라고 10배 더 좋은 것이 아닙니다. **이상값(outlier)이 모델을 지배하지 않도록 상한선**을 둔 것입니다.

---

### ⑤ 영업 상태 — 왜 True/None/False로 3단계인가?

`{True: 1.0, None: 0.5, False: 0.0}[open_status]`

단순히 "영업 중 = 1, 영업 외 = 0"이 아닙니다. `None`(정보 없음)을 0.5로 처리합니다.

**이유:** TripAdvisor에서 영업 시간 정보가 없는 장소들이 많습니다. 이때 0으로 처리하면 영업 정보가 없는 모든 장소가 불이익을 받습니다. 0.5는 "알 수 없지만, 아마도 영업 중일 수도 있다"는 중립적 가정입니다. 정보 부재를 결핍으로 오해하지 않기 위한 장치입니다.

---

### ⑥ B(맛집 투어) 코스 거리 정규화 `min(place.distance, 5000) / 5000.0`

```jsx
def _tensor_6(place: PlaceInput) -> torch.Tensor:
    feats = _base_features(place)
    return torch.tensor([*feats, min(place.distance, 5000) / 5000.0], ...)
```

routemodel.py:362-363

**5000m(5km) 이상은 모두 1.0으로 처리합니다.**

**이유:** 맛집 투어는 걸어서 이동하는 경우가 많습니다. 5km 이상 이동하는 맛집은 관광 동선에 포함하기 어렵습니다. **5km를 "최대 고려 거리"로 설정하고, 그 이상은 모두 동등하게 "너무 멀다"고 취급**합니다.

---

## 5. 최종 점수 공식 — 왜 이렇게 설계했는가

```jsx
def compute_place_score(place, model, cat_weights):
    rating_score = place.rating * math.log10(place.num_reviews + 1)
    cat_weight   = weights.get(place.category, 1.0)
    award_count  = len(place.awards)
    nn_quality   = model(x.unsqueeze(0)).item()  # 0~1

    return (nn_quality * rating_score * cat_weight) + (award_count * 0.5)
```

routemodel.py:641-655

이 공식은 세 가지 요소의 **곱(×)과 덧셈(+)을 의도적으로 분리**했습니다. 그 이유가 중요합니다.

공식에 등장하는 변수는 총 4개입니다. 각각이 무엇을 의미하는지 먼저 짚고 넘어갑니다.

---

### 변수 1: `rating_score` — "얼마나 검증된 장소인가"

`rating_score = place.rating * math.log10(place.num_reviews + 1)`

TripAdvisor에서 가져온 **평점(rating)** 과 **리뷰 수(num_reviews)** 를 조합한 값입니다.

**평점만 쓰지 않는 이유가 있습니다. 리뷰가 2개뿐인 장소의 평점 5.0과, 리뷰가 1,000개인 장소의 평점 4.5는 같은 5.0, 4.5라도 신뢰도가 완전히 다릅니다. `rating_score`는 이 둘을 곱해서 "많은 사람이 검증한 좋은 평점"에 높은 값을 부여합니다.**

- 평점 5.0 / 리뷰 2개: `5.0 × log10(3) ≈ 2.4`
- 평점 4.5 / 리뷰 1000개: `4.5 × log10(1001) ≈ 13.5`

리뷰 2개짜리 만점보다 리뷰 1,000개짜리 4.5점이 훨씬 높게 나옵니다. **평점만 보면 오해할 수 있는 부분을 리뷰 수가 보정**합니다.

---

### 변수 2: `nn_quality` — "신경망이 판단한 이 장소의 관광 가치"

`nn_quality = model(x.unsqueeze(0)).item()  # 0~1 사이 숫자`

**`model`은 `weights_A.pt`, `weights_B.pt`, `weights_C.pt`** 중 하나를 불러온 신경망(A: 명소 탐방, B: 맛집 투어, C: 반나절 코스)입니다. 이 신경망에 장소의 5가지 특성(평점, 리뷰수, 리뷰품질, 수상이력, 영업상태)을 입력으로 주면, **0과 1 사이의 숫자 하나**를 출력합니다.

이 숫자가 `nn_quality`입니다. **1에 가까울수록 "이 장소는 관광지로서 가치 있다", 0에 가까울수록 "별로다"**를 의미합니다.

중요한 점은, 이 판단 기준이 **사용자 피드백을 통해 계속 개선**된다는 것입니다. 처음에는 랜덤에 가까운 판단을 하다가, 사람들이 코스를 선택할수록 `.pt` 파일 안의 수천 개 숫자가 조금씩 조정되면서 점점 더 정확한 판단을 하게 됩니다.

***예를 들어 영업 중이고, 리뷰 품질도 높고, 수상 이력도 있는 갤러리를 계속 사람들이 선택했다면 → 신경망은 그런 특성 조합에 높은 점수를 주도록 학습됩니다.***

---

### 변수 3: `cat_weight` — "이 코스에서 이 카테고리가 얼마나 중요한가"

**`cat_weight = weights.get(place.category, 1.0)`**

`weights`는 아래처럼 코드에 직접 적힌 딕셔너리입니다. 코스마다 다릅니다.

```jsx
_W_SIGHT = {"명소": 2.0, "카페": 0.3, "식당": 0.2, ...}  # A코스용
_W_FOOD  = {"식당": 2.2, "카페": 1.8, "명소": 0.8, ...}  # B코스용
_W_BAL   = {"명소": 1.4, "식당": 1.3, "카페": 1.2, ...}  # C코스용

# 맞춤 코스: category_weights.json에서 동적으로 로드
load_category_weights()  # {"명소": 1.832, "식당": 1.331, "문화": 1.701, ...}
```

장소의 카테고리(예: "명소", "식당")를 이 딕셔너리에서 찾아서 가져오는 숫자입니다. 해당 카테고리가 딕셔너리에 없으면 기본값 1.0을 씁니다. 

**맞춤 코스는 category_weights.json에서 읽어온 동적 가중치를 사용합니다.** 사용자가 코스를 선택할 때마다 EMA 방식으로 갱신되므로, **사용자의 선택 이력이 쌓일수록 해당 사용자가 선호하는 카테고리의 가중치가 높아집니다.**

**`nn_quality`와 결정적으로 다른 점이 있습니다. `nn_quality`는 피드백으로 변하지만, `cat_weight`는 코드에 (A, B, C 한정) 고정된 숫자라 절대 바뀌지 않습니다. 본인이 "A코스는 명소 위주여야 한다"고 직접 정의한 규칙입니다.**

**즉, `nn_quality`는 "얼마나 좋은 장소인가"를 판단하고, `cat_weight`는 "이 코스에서 이 카테고리가 필요한가"를 판단합니다. 역할이 완전히 다릅니다.**

---

### 변수 4: `award_count` — "공식 수상 이력 개수"

`award_count = len(place.awards)`

**TripAdvisor에서 제공하는 수상 내역의 개수**입니다. "올해의 여행자 선정", "우수 서비스상" 같은 공식 인증 개수를 그대로 셉니다.

---

### 곱셈 부분: `nn_quality × rating_score × cat_weight`

세 변수를 곱셈으로 묶는 이유가 있습니다. 곱셈은 **하나라도 낮으면 전체가 낮아지는 구조**입니다.

- 아무리 유명한 식당(`rating_score` 높음)이어도, A코스에서 식당 가중치(`cat_weight` = 0.2)가 낮으면 최종 점수가 낮아집니다. (A 코스에는 식당의 비중이 낮아도 되기 때문)
- 아무리 신경망이 좋다고 판단(`nn_quality` 높음)해도, 리뷰가 거의 없는 장소(`rating_score` 낮음)면 최종 점수가 낮아집니다.
- 세 가지 관점(신경망 판단 + 검증된 인기 + 코스 적합성)이 **모두 충족되어야** 높은 점수가 나옵니다.

만약 덧셈으로 합쳤다면 하나의 지표가 나빠도 다른 지표가 보완할 수 있습니다. 곱셈은 이를 허용하지 않습니다. **"세 기준 모두 통과해야 추천할 수 있다"는 엄격한 기준**입니다.

---

### 덧셈 부분: `+ (award_count × 0.5)`

수상 이력은 곱셈이 아닌 덧셈으로 추가합니다.

**이유:** 수상 이력은 **다른 지표와 독립적인 품질 보증**입니다. 리뷰가 없어도, 평점이 낮아도, "공식적으로 인정받은 장소"라는 사실은 변하지 않습니다. 곱셈으로 처리하면 다른 점수가 0일 때 수상 이력의 의미가 사라집니다. 덧셈으로 처리해야 "다른 건 몰라도 수상만으로 최소한 이 정도는 된다"는 베이스라인 점수를 줄 수 있습니다.

`0.5`라는 계수는 수상 1개당 최종 점수에 0.5를 추가합니다. 이 수치는 `rating_score`의 평균 크기(약 2~8 수준)와 비교해 "**보조적"인 역할을 하도록 조정된 값**입니다.

---

## 6. 코스별 가중치 설계 — 왜 이렇게 다른가

```jsx
_W_SIGHT = {"명소": 2.0, "문화": 1.8, "갤러리": 1.5, "공원": 1.3,
            "거리": 0.8, "카페": 0.3, "식당": 0.2}   # A코스

_W_FOOD  = {"식당": 2.2, "카페": 1.8, "명소": 0.8, "문화": 0.6,
            "공원": 0.5, "갤러리": 0.5, "거리": 0.4}  # B코스

_W_BAL   = {"명소": 1.4, "식당": 1.3, "카페": 1.2, "문화": 1.2,
            "공원": 1.1, "갤러리": 1.0, "거리": 0.9}  # C코스
            
# 맞춤 코스: category_weights.json에서 동적으로 로드
load_category_weights()  # {"명소": 1.832, "식당": 1.331, "문화": 1.701, ...}
```

routemodel.py:685-690

**A코스에서 카페가 0.3, 식당이 0.2인 이유:**

명소 탐방 코스에서는 식당과 카페가 등장하면 안 됩니다. 하지만 완전히 0으로 만들지 않는 이유는, 주변에 명소가 전혀 없고 식당밖에 없는 극단적인 상황에서도 코스를 만들어야 하기 때문입니다. 0.2~0.3은 "사실상 선택 안 함, 그러나 완전한 제외도 아님"을 의미합니다.

**B코스에서 식당이 2.2로 가장 높은 이유:**

맛집 투어는 식당이 핵심입니다. 2.2는 이 목록에서 가장 높은 값으로, "같은 품질이라면 식당을 무조건 우선 선택"을 의미합니다. 카페는 1.8로 두 번째인데, 카페 투어도 맛집 투어의 연장선상에 있기 때문입니다.

**C코스에서 모든 카테고리가 0.9~1.4로 고르게 분포하는 이유:**

반나절 코스는 다양성이 목표입니다. 어떤 카테고리도 압도적으로 우선시되면 안 되므로 가중치 차이를 최소화했습니다. 단, 명소(1.4)가 가장 높은 이유는 "반나절 코스의 하이라이트는 여전히 관광지"여야 하기 때문입니다.

---

### 카테고리 가중치와 `.pt` 파일의 가중치는 무엇이 다른가?

이 시점에서 자연스럽게 드는 의문이 있습니다. **"위에서 설명한 카테고리 가중치(`_W_SIGHT` 등)와, 신경망이 저장하는 `weights_A.pt` 파일 안의 가중치는 같은 건가?"**

**결론부터 말하면 완전히 다른 것입니다.**

|  | 카테고리 가중치 (`_W_SIGHT` 등) | `.pt` 파일 가중치 |
| --- | --- | --- |
| **누가 정했나** | 개발자가 직접 손으로 설정 | 학습(역전파)으로 자동 조정 |
| **무엇을 판단하나** | "어떤 **카테고리**를 이 코스에서 중요하게 볼 것인가" | "**평점/리뷰/수상** 등 특성들을 어떻게 조합하면 좋은 장소인가" |
| **바뀌는가** | A/B/C는 고정, 맞춤 코스는 피드백마다 갱신 | 사용자 피드백 때마다 바뀜 |
- **맞춤 코스는 위 딕셔너리가 아닌 category_weights.json 파일에서 읽어옵니다.** 초기값은 C코스의 _W_BAL과 유사한 균형 분포이지만, 사용자가 코스를 선택할 때마다 EMA 방식으로 갱신됩니다. 현재 예시: {"명소": 1.832, "문화": 1.701, "식당": 1.331, ...} — 이 사용자는 명소와 문화 카테고리를 더 많이 선택해왔음을 나타냅니다.

비유하자면 이렇습니다. 맛집을 평가하는 심사위원이 있다고 할 때:

- **`.pt` 가중치** = 심사위원 본인의 **미각과 판단 기준** ("재료 신선도, 맛의 균형, 서비스를 어떻게 종합해서 점수를 낼까")
- **카테고리 가중치** = **심사 규칙** ("이번 대회는 한식 부문이니까 한식 식당에 2배 가산점")

심사위원의 미각(`.pt`)은 경험이 쌓이면서 개선되고, 대회 규칙(카테고리 가중치)은 코스 성격에 따라 고정되어 있습니다.

최종 점수 공식에서 각각의 위치를 다시 보면 이 차이가 명확합니다:

```jsx
final_score = (nn_quality  ×  rating_score  ×  cat_weight) + award_bonus
	                                                  ↑
																      딕셔너리 또는 JSON 파일에서 나온 값
								                    (A/B/C 고정 | 맞춤 코스는 EMA로 갱신)
```

`nn_quality`는 신경망이 `.pt` 파일의 수천 개 숫자를 이용해 계산한 결과이고, `cat_weight`는 그냥 딕셔너리에서 꺼낸 고정값 / category_weights.json 파일에서 읽어온 값입니다. 사용자 피드백으로 개선되는 것은 `nn_quality` , category_weights.json 파일에서 읽어온 값 쪽이고, 카테고리 가중치는 "이 코스의 정체성"을 고정적으로 정의하는 역할을 합니다.

---

## 7. 점수 정규화 — 왜 MinMaxScaler를 중간에 넣었나

```jsx
if df["final_score"].nunique() > 1:
    df["final_score"] = scaler.fit_transform(df[["final_score"]]).flatten()
```

routemodel.py:906-907

**모든 장소에 점수를 매긴 후, 이 점수들을 다시 0~1로 정규화합니다.**

**이유:** 코스마다 다른 가중치를 쓰기 때문에 코스별로 점수의 절댓값이 다릅니다. A코스는 최대 점수가 15.0일 수 있고, B코스는 최대 점수가 30.0일 수 있습니다. 정규화 없이 선택하면 실제로 "점수가 더 높은 장소"를 선택하는 게 아니라 "가중치가 큰 코스의 장소"가 늘 이겨버립니다. 정규화로 모든 코스에서 공정한 비교를 가능하게 합니다.

`.nunique() > 1` 조건을 확인하는 이유: 모든 장소의 점수가 동일하다면 MinMaxScaler가 0으로 나누기 오류를 냅니다. 이를 방어합니다.

---

## 8. C(반나절)코스 선정 로직 — 왜 Greedy 방식인가

```jsx
def select_balanced(df: pd.DataFrame) -> pd.DataFrame:
    df["efficiency"] = df["final_score"] - df["distance_m"] / 600.0  # 핵심 공식!
    by_eff = df.sort_values("efficiency", ascending=False)
    selected_ids = []
    used_cats    = set()
    for _, row in by_eff.iterrows():
        if row["category"] not in used_cats:       # 새 카테고리면 먼저 채택
            selected_ids.append(row["id"])
            used_cats.add(row["category"])
```

routemodel.py:712-729

### 효율 점수 공식: `efficiency = final_score - distance_m / 600.0`

**왜 600으로 나누는가?**

**`distance_m / 600.0`은 거리를 점수 단위로 변환하는 계수**입니다. 600m 멀어질수록 점수가 1.0 감소합니다. 이 값은 **"600m 추가 이동의 피로도 ≈ 품질 점수 1.0의 가치"라는 판단 기준**입니다.

예를 들어:

- 장소 A: 점수 0.8, 거리 100m → efficiency = 0.8 - 0.17 = 0.63
- 장소 B: 점수 0.9, 거리 800m → efficiency = 0.9 - 1.33 = **0.43** (너무 멀어서 마이너스)

반나절 코스는 도보 이동이 많으므로 이동 거리 패널티가 중요합니다.

**왜 "카테고리 먼저, 점수 나중"인가?**

만약 단순히 점수 상위 5개를 뽑으면, 모두 "명소" 카테고리만 선택될 수 있습니다. **C코스의 목표는 다양성**입니다. 그래서 첫 번째 반복에서는 **아직 선택되지 않은 카테고리의 장소**만 우선 채택합니다. 모든 카테고리가 한 번씩 뽑히고 나면, 두 번째 반복에서 남은 자리를 점수 순으로 채웁니다.

---

## **9. 맞춤 코스 선정 로직 — EMA 카테고리 가중치 기반**

```python
def select_personalized(df: pd.DataFrame) -> pd.DataFrame:
    weights = load_category_weights()
    priority_cats = sorted(weights.keys(), key=lambda c: weights[c], reverse=True)

    df = df.copy()
    df["efficiency"] = df["final_score"] - df["distance_m"] / 600.0

    selected_ids: list[str] = []

    # 1) 가중치 높은 카테고리부터, 카테고리당 "최고 효율" 1개씩 채택
    for cat in priority_cats:
        if len(selected_ids) >= MAX_PLACES:
            break

        best = df[df["category"] == cat].sort_values("efficiency", ascending=False)
        if not best.empty:
            selected_ids.append(best.iloc[0]["id"])

    # 2) 남은 슬롯은 효율(efficiency) 순으로 보충
    by_eff = df.sort_values("efficiency", ascending=False)
    for _, row in by_eff.iterrows():
        if len(selected_ids) >= MAX_PLACES:
            break
        if row["id"] not in selected_ids:
            selected_ids.append(row["id"])

    return df[df["id"].isin(selected_ids)]
```

### **C코스(반나절)와 비교**

C코스(select_balanced)와 맞춤 코스(select_personalized)는 모두 efficiency 점수를 사용하고 같은 신경망(_model_C)으로 채점합니다. 차이는 **카테고리 우선순위를 어디서 가져오느냐**입니다.

- **C코스**: 카테고리 다양성이 목표 → 아직 선택되지 않은 카테고리를 순서 없이 우선
- **맞춤 코스**: 사용자 선호 카테고리가 목표 → EMA 가중치가 높은 카테고리부터 슬롯 배정

결과적으로 맞춤 코스는 "사용자가 자주 선택해온 카테고리의 최고 효율 장소"를 먼저 채운 뒤 남은 슬롯을 채웁니다.

### **EMA 가중치는 어떻게 갱신되나**

### route.py — POST /route/feedback 호출 시

```python
def _update_weights(weights, selected_categories):
	for cat, w in weights.items():
		if cat in selected_categories:
			new_weights[cat] = w * (1.0 + 0.05)   # 선택된 카테고리 +5%
	else:
		new_weights[cat] = w * (1.0 - 0.015)  # 선택 안된 카테고리 -1.5%
```

### 전체 합을 초기값 합으로 정규화 (스케일 드리프트 방지)

route.py:48-60

사용자가 어떤 코스를 선택하든, 그 코스 장소들의 카테고리가 selected_categories로 전달됩니다. 학습률 0.05로 EMA 갱신 후 전체 합이 드리프트되지 않도록 정규화합니다. 이 결과가 category_weights.json에 저장되고, 다음 추천 요청에서 load_category_weights()가 이 파일을 읽어 맞춤 코스 선정에 사용합니다.

**load_category_weights()는 캐싱 없이 매 요청마다 파일을 직접 읽습니다.** 덕분에 피드백이 반영된 직후 다음 추천부터 곧바로 업데이트된 가중치가 적용됩니다.

---

## 10. TSP 최적화 — Dijkstra + Held-Karp 조합의 이유

### 왜 Dijkstra가 필요한가?

```jsx
shortest = {
    src: dict(nx.single_source_dijkstra_path_length(G, src))
    for src in all_nodes
}
```

routemodel.py:423-425

좌표 거리(직선 거리)와 실제 이동 거리는 다릅니다. 하지만 이 단계에서는 카카오 Directions API를 매번 호출하기 어렵습니다 (속도 문제, API 비용). 대신 **UTM 좌표계(미터 단위)에서의 직선 거리**를 Dijkstra로 계산합니다.

Dijkstra는 "노드 간 모든 최단 경로를 미리 계산"합니다. 5개 장소가 있으면 모든 쌍(10개 조합)의 거리를 한 번에 계산해 딕셔너리에 저장합니다. 이후 Held-Karp가 이 딕셔너리를 조회만 하면 되므로 매우 빠릅니다.

### 왜 단순 브루트포스가 아닌 Held-Karp인가?

5개 장소의 방문 순서 경우의 수: 5! = **120가지**
단순 비교로도 가능하지만, 장소가 8개라면 8! = 40,320가지, 10개면 3,628,800가지입니다.

**Held-Karp의 시간 복잡도: O(2ⁿ × n²)**

- n=5: 2⁵ × 25 = **800번 연산** (브루트포스 120과 비슷)
- n=10: 2¹⁰ × 100 = **102,400번 연산** (브루트포스 3,628,800과 비교해 35배 빠름)

이 프로젝트는 현재 최대 5개 장소를 쓰지만, **나중에 장소 수를 늘려도 성능 저하 없이 확장 가능하도록** Held-Karp를 선택했습니다.

### Held-Karp의 핵심 아이디어 — 비트마스크

```jsx
dp[(1 << i, i)] = d(user_node, node)
# ...
for mask in range(1, 1 << n):
    new_mask = mask | (1 << next_i)
    new_cost = curr_cost + d(place_nodes[last_i], place_nodes[next_i])
```

routemodel.py:436-455

**비트마스크란? 2진수로 "어떤 장소를 방문했는지"를 표현합니다.**

장소 3개(A, B, C)를 예로:

```jsx
001 (1) = A만 방문
010 (2) = B만 방문
011 (3) = A, B 방문
100 (4) = C만 방문
101 (5) = A, C 방문
110 (6) = B, C 방문
111 (7) = A, B, C 모두 방문
```

**`dp[(mask, last)]`**는 **"mask 상태에서 last를 마지막으로 방문했을 때의 최소 이동 거리"**를 저장합니다. 이미 계산된 부분 경로를 재활용하므로 같은 계산을 두 번 하지 않습니다. 이것이 동적 계획법(DP)의 핵심입니다.

### 왜 2-opt를 추가로 적용하는가?

```jsx
hk_route  = _dijkstra_held_karp(G, 0, place_nodes)
full_route = [0] + hk_route
opt_route  = _two_opt(full_route, dist_matrix)  # 2-opt 후처리
```

routemodel.py:590-593

Held-Karp는 **정확한 최적해**를 구합니다. 그런데 **왜 2-opt를 또 적용할까요?**

이유: Held-Karp는 **유클리드(직선) 거리 기반**으로 최적화합니다. 실제 지도에서는 도로 구조 때문에 두 경로가 교차하는 것처럼 보여도 실제 이동 거리가 더 짧을 수 있습니다. 2-opt는 **"선이 교차하는 구간을 뒤집어 교차를 제거"하는 방식으로 시각적으로도 더 자연스러운 경로**를 만듭니다.

**2-opt vs 경로 유형에 따른 차이:**

```jsx
def _two_opt(route, dist):       # 추천 탭: 순환 경로 (출발=도착 아님, 시작점 고정)
def _two_opt_path(route, dist):  # 직접 입력: 경로 (출발·도착 고정)
```

**추천 경로는 "어디서든 돌아올 필요 없이" 탐방하는 코스이므로 `순환형 2-opt`를 씁니다. 직접 입력 경로는 "출발지에서 도착지까지" 가야 하므로 `양 끝을 고정한 2-opt`를 씁니다. 이 차이를 코드에서 명시적으로 분리한 것입니다.**

---

## 11. 온라인 피드백 학습 — 가장 정교한 설계

```jsx
def _train_one(model, pos_tensors, neg_tensors, lr=0.005, steps=15):
    X = torch.stack(pos_tensors + neg_tensors)
    y = torch.tensor([1.0]*len(pos_tensors) + [0.0]*len(neg_tensors))
    optimizer = torch.optim.Adam(model.parameters(), lr=lr)
    for step in range(steps):
        loss = F.binary_cross_entropy(model(X), y)
        loss.backward()
        optimizer.step()
```

routemodel.py:764-796

### BCE Loss를 쓰는 이유

Binary Cross-Entropy(BCE) 손실함수는 **0/1 분류 문제**에 최적화된 손실함수입니다. **모델 출력이 Sigmoid(0~1)이고, 레이블이 0 또는 1인 상황에 수학적으로 가장 잘 맞습니다.**

BCE 공식:

**`Loss = -[y × log(p) + (1-y) × log(1-p)]`**

- y=1(선택됨), p=0.9: Loss = -log(0.9) ≈ 0.10 (작은 손실, 이미 잘 예측)
- y=1(선택됨), p=0.1: Loss = -log(0.1) ≈ 2.30 (큰 손실, 틀리게 예측)
- y=0(선택 안 됨), p=0.9: Loss = -log(0.1) ≈ 2.30 (큰 손실)

모델이 틀릴수록 손실이 급격히 커지는 특성 덕분에 학습 신호가 강합니다.

### Adam 옵티마이저를 쓰는 이유

SGD(기본 경사하강법)보다 Adam이 적합한 이유: 온라인 학습은 한 번에 소수의 샘플(15~30개 장소)만 주어집니다. 이 경우 SGD는 학습이 불안정합니다. Adam은 **적응형 학습률**을 사용해 각 파라미터마다 학습 속도를 자동 조절하여 소수 샘플에서도 안정적으로 학습합니다.

### 학습률 0.005와 15스텝의 근거

`lr: float = 0.005,
steps: int = 15,`

**0.005라는 학습률:** 너무 크면(예: 0.1) 한 번의 피드백이 모델을 과도하게 변경해 이전 학습 내용을 망칩니다. 너무 작으면(예: 0.0001) 피드백이 반영되지 않습니다. 0.005는 "한 사용자의 피드백이 모델에 적당히 반영되는" 중간 지점입니다.

**15스텝:** 동일한 데이터로 15번 반복 학습합니다. 단 1번만 학습하면 피드백 신호가 약합니다. 너무 많이 반복(예: 100번)하면 이 사용자의 취향에만 과도하게 맞춰집니다. 15는 "충분히 학습하되, 과적합하지 않는" 경험적 균형값입니다.

### 동시 요청 직렬화 — `_MODEL_LOCK`

```jsx
_MODEL_LOCK = threading.Lock()

with _MODEL_LOCK:
    _update_models_from_feedback(...)
```

routemodel.py:63, routemodel.py:983-984

여러 사용자가 동시에 피드백을 보내면, 두 학습 과정이 동시에 같은 모델 가중치를 수정합니다. 이는 **경쟁 조건(race condition)** 이라 불리는 버그로, 가중치가 손상될 수 있습니다. **`threading.Lock()`**은 한 번에 하나의 피드백만 모델을 업데이트할 수 있도록 강제합니다. 나머지 요청은 순서를 기다립니다.

### 3개 모델에 모두 같은 피드백을 주는 이유

```jsx
_train_one(_model_A, pos_5, neg_5, ...)  # A모델도 학습
_train_one(_model_B, pos_6, neg_6, ...)  # B모델도 학습
_train_one(_model_C, pos_5, neg_5, ...)  # C모델도 학습
```

사용자가 B코스(맛집)를 선택했다면, 그 장소들은 실제로 좋은 장소들입니다. 비록 A코스(명소)가 뽑지 않은 장소들이지만, "이 장소들이 좋다/나쁘다"는 정보는 A코스와 C코스 모델에도 학습 신호가 됩니다. 결국 세 모델 모두 "좋은 장소와 나쁜 장소를 구별하는 공통 기반"을 공유하면서, 코스별 특화는 카테고리 가중치가 담당합니다.

**맞춤 코스는 _model_C(반나절, 다양한 유형)를 공유하므로 별도의 MLP 피드백 학습 경로가 없습니다. 대신 category_weights.json EMA 갱신(POST /route/feedback)이 맞춤 코스의 개인화를 담당합니다.**

---

## 11. 전체 파이프라인 요약 흐름도

```jsx
사용자 요청 수신
       ↓
① 블랙리스트 필터링 (생활시설 제거)
       ↓
② 재난구역 필터링 (Haversine 거리 계산)
       ↓
③ extra_places 보충 (재난으로 제거된 수만큼)
       ↓
④ 각 장소별 5차원/6차원 특성 추출
       │  [rating, log_reviews, review_quality, awards, open_status, (distance_B)]
       ↓
⑤ 코스별 독립 MLP 채점 (A/B/C 모델 병렬 실행, 맞춤: PlaceScoringNetC + load_category_weights() (EMA 동적 가중치))
       │  nn_quality = model(features)  → 0~1
       ↓
⑥ 최종 점수 = (nn_quality × rating_score × cat_weight) + award_bonus
       ↓
⑦ MinMaxScaler로 코스별 점수 0~1 정규화
       ↓
⑧ 코스별 장소 선정
       │  맞춤: EMA 가중치 높은 카테고리 순으로 1슬롯씩 배정 → 나머지 효율 순 보충
       │  A: 점수 상위 5개 (명소 우선)
       │  B: 식당/카페 3개 + 명소 2개
       │  C: 카테고리 다양성 + 거리 효율 Greedy 선정
       ↓
⑨ 선정된 5개 장소의 방문 순서 최적화
       │  Dijkstra (모든 쌍 최단 거리 사전 계산)
       │  Held-Karp DP (bitmask 최적 경로)
       │  2-opt (교차 제거 후처리)
       ↓
⑩ 4개 코스 반환
       ↓
사용자가 코스 선택
       ↓
⑪ 피드백 학습
       │  선택 코스 장소 → positive (y=1)
       │  미선택 장소 → negative (y=0)
       │  BCE Loss + Adam 15스텝 학습
       │  가중치 파일 즉시 저장
       │
⑫ 카테고리 가중치 EMA 갱신 (POST /route/feedback)
		   │  선택 코스 장소의 카테고리 → +5% EMA 갱신
		   │  나머지 카테고리 → -1.5% EMA 갱신
		   │  category_weights.json 저장 (다음 맞춤 코스 추천에 즉시 반영)
       ↓
다음 요청부터 개선된 모델 적용
```

---
