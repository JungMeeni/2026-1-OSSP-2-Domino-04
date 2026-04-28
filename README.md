# 2026-1-OSSP-2-Domino-04
외국인들을 위한 관광지 및 명소 추천 서비스

## Rule
본 프로젝트는 Forking Workflow를 기반으로 운영됩니다. 모든 개발은 develop 브랜치를 중심으로 이루어지며, 파트별 검증 후 최종 배포 시에만 main을 사용합니다.

  - ### Commit 양식         
      | 유형    |  tagname |
      | ----- | -------- |
      | 추가    | add      |
      | 삭제    | del      |
      | 수정    | mod      |
      | 버그 수정 | fix      |

    Default: `[ 파트명 | 본인이름 | 유형 ]` -> 항상 commit message 맨 앞에 붙어야 함.

  - ### Branch Structure
```
  main (Release)      : 최종 배포 및 서비스 운영
  └── develop (Dev)   : 모든 파트 코드가 합쳐지는 중심축 (Default)
       ├── frontend   : 프론트엔드 작업 통합 브랜치
       │    ├── feat/front-taehyeon
       │    └── feat/front-hyojun
       └── backend    : 백엔드 작업 통합 브랜치
            ├── feat/back-deokwon
            └── feat/back-jeongmin
```
  - ### Initial Setup (최초 1회): 팀 저장소를 본인 계정으로 Fork한 후, 로컬에서 아래 명령어를 실행합니다.
      #### 1. Fork한 본인 저장소 clone
      `git clone https://github.com/YourID/project-name.git`

      #### 2. 원본 팀 저장소를 upstream이라는 이름으로 연결 (동기화 용도)
      `git remote add upstream https://github.com/TeamName/project-name.git`

      #### 3. 본인 파트 브랜치 생성 및 이동 (예: 프론트엔드 태현)
      `git checkout -b feat/front-taehyeon`

  - ### Daily Workflow (개발 진행): 작업을 시작하기 전과 완료한 후에는 반드시 아래 순서를 따릅니다.
    - #### 동기화: 작업 전 upstream/develop의 최신 내용을 가져옵니다.
      - `git pull upstream develop`
        
    - #### 작업 및 커밋: 본인 브랜치에서 기능을 구현합니다.
    - #### Push: 본인의 Fork 저장소(origin)에 올립니다.
      - `git push origin feat/front-taehyeon`
        
    - #### PR(Pull Request) 생성: GitHub 웹페이지에서 Compare & pull request 버튼 클릭
      - **base repository**: TeamName/project-name (base: frontend 또는 backend)
      - **head repository**: YourID/project-name (compare: feat/본인이름)

  - ### Merge: 파트원 리뷰 후, 각 파트별 대표가 확인하여 팀 저장소에 반영합니다.
  - ### Final Merge: 두 파트 모두 이상이 없다면, 팀장이 최종적으로 develop branch에 Merge 합니다.

  - ### ⚠️ 중요 규칙 (Must Read)
    - **타 파트와 연동 확인**: 로컬에서 `git pull upstream backend(혹은 frontend)`를 실행하여 타 파트 코드를 가져와 테스트합니다.
    - **Conflict 발생 시**: 로컬에서 develop을 pull 받아 충돌을 해결한 후 다시 push합니다.
    - **Commit format 통일**: 반드시 commit 양식을 준수합니다.
