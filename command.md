# docker
# 1. 실행 중인 모든 컨테이너 중지 및 관련 리소스 삭제
docker-compose down
# 2. 기존에 생성된 이미지를 강제로 삭제 (이미지 이름이 다를 수 있으니 주의)
# 만약 이미지를 못 찾겠다면 이 단계는 건너뛰어도 좋습니다.
docker rmi $(docker images -q) --force
# 3. 캐시를 전혀 사용하지 않고 처음부터 끝까지 다시 빌드
docker-compose build --no-cache
# 4. 서버 실행
docker-compose up

# 1. 요청 예
카카오맵 호출
http://localhost:3000/api/map/search?query=강남역


# github 프로토콜
# 1. git checkout feat/back-deokwon
# 2. 원본 저장소의 최신 코드(develop)를 내 브랜치로 병합
git pull upstream develop
# 3. 변경된 파일 스테이징
git add .

# 4. 커밋 메시지 작성 (팀 규칙 준수)
git commit -m "feat: [back | 정덕원 | add OR del OR mod OR fix ] 상세 구현 내용"
# 5. 내 Fork 저장소로 푸시
git push origin feat/back-deokwon

# 1. 최신 develop 상태를 다시 가져오기
git checkout feat/back-deokwon
git pull upstream develop

# 2. 충돌 파일 수정 (IDE 활용)

# 3. 수정 완료 후 다시 푸시
git add .
git commit -m "chore: resolve conflict with develop"
git push origin feat/back-deokwon