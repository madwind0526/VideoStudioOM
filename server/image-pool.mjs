import { readFile } from "node:fs/promises";

import { writeFileAtomic } from "./fs-util.mjs";
import { HttpError } from "./http.mjs";

/** The categories of the built-in pool: the id (used by the screen and the file) and its name on the screen. */
export const POOL_CATEGORIES = [
  { id: "person", label: "인물" },
  { id: "outfit", label: "의상" },
  { id: "expression", label: "표정·시선" },
  { id: "action", label: "동작" },
  { id: "place", label: "배경" },
  { id: "time", label: "시간·날씨" },
  { id: "camera", label: "구도" },
  { id: "lighting", label: "조명" },
  { id: "palette", label: "색감" },
  { id: "style", label: "화풍" },
  { id: "prop", label: "소품" },
];
const MAX_CATEGORIES = 30;
const MAX_PHRASES = 300;
const MAX_LENGTH = 1000;

/** Used while the user has no data/image-pools.json; a saved file replaces it whole. */
export const DEFAULT_POOL = {
  person: [
    "20대 후반의 단발머리 여성", "30대 중반의 수염 난 남성", "백발이 성성한 노년의 여성", "10대 후반의 곱슬머리 소년", "긴 생머리의 40대 여성", "어깨가 넓은 체격 좋은 중년 남성",
    "안경을 쓴 20대 남성", "주근깨가 있는 붉은 머리 소녀", "짧은 은발의 60대 남성, 깊게 팬 주름", "검은 단발에 앞머리가 있는 20대 초반 여성", "구릿빛 피부에 곱슬머리를 높이 묶은 30대 여성",
    "다부진 체구에 수염을 기른 50대 어부", "큰 눈과 보조개가 있는 10대 소녀", "긴 팔다리에 마른 체형의 20대 남성 모델", "헝클어진 머리의 30대 남성 예술가", "단정하게 머리를 올린 70대 할머니",
    "문신이 있는 삭발한 30대 남성", "웨이브 단발의 40대 여성 건축가", "앳된 얼굴의 짧은 머리 소년", "중년의 한국인 남성 요리사", "허리까지 오는 흑발의 20대 한국 여성", "검은 곱슬머리의 아프리카계 20대 남성",
    "금발 포니테일의 20대 여성", "턱수염이 짙은 중동계 30대 남성", "작은 체구에 둥근 안경을 쓴 노년 남성", "긴 코트가 어울리는 키 큰 30대 여성",
    "붉은 곱슬머리에 주근깨가 많은 20대 청년", "짧은 흑발에 날카로운 눈매의 30대 여성 형사", "흰 수염이 풍성한 70대 뱃사공",
    "단발 웨이브에 큰 귀걸이를 한 40대 재즈 가수", "민머리에 안경을 쓴 50대 학자", "탄탄한 체격에 헬멧을 옆구리에 낀 20대 오토바이 라이더",
    "긴 머리를 땋아 내린 10대 후반 소녀", "붉은 립스틱에 짧은 보브컷의 30대 여성 배우", "수염을 짧게 다듬은 30대 남성 바리스타",
    "장난기 가득한 얼굴의 7살 어린이", "회색 장발을 하나로 묶은 60대 여성 화가", "운동으로 다져진 몸의 20대 여성 복서",
    "갈색 피부에 긴 속눈썹을 가진 20대 인도계 여성", "단정한 가르마의 40대 남성 변호사", "넓은 챙 모자를 눌러 쓴 30대 여행가",
    "금속테 안경을 쓴 20대 후반 여성 개발자", "키가 크고 마른 50대 남성 사진작가", "이마가 시원한 곱슬머리의 30대 남성 DJ"
  ],
  outfit: [
    "낡은 가죽 재킷과 청바지", "깔끔한 네이비 정장", "흰 린넨 셔츠와 베이지 바지", "붉은 체크무늬 플란넬 셔츠", "검은 롱코트와 목도리", "꽃무늬 원피스", "노란 우비", "손으로 짠 두꺼운 아이보리 스웨터",
    "검은 터틀넥과 와이드 칼라 코트, 슬림한 검은 바지", "구조감 있는 검은 블레이저와 몸에 붙는 검은 셔츠", "빈티지 데님 재킷과 흰 티셔츠", "오버사이즈 회색 후드와 카고 팬츠", "하늘색 실크 블라우스와 롱스커트",
    "전통 한복, 은은한 색의 저고리와 치마", "베이지 트렌치코트와 가죽 장갑", "작업용 가죽 앞치마와 걷어 올린 소매", "반짝이는 은색 이브닝 드레스", "광택 있는 붉은 새틴 셔츠", "울 체크 재킷과 터틀넥, 갈색 부츠",
    "민소매 흰 원피스와 밀짚모자", "스트리트 스타일의 큰 패딩 점퍼", "낡은 군용 파카", "단정한 교복 블레이저와 체크 치마", "자수가 놓인 짙은 녹색 벨벳 재킷", "검은 가죽 라이더 재킷과 검은 장갑", "흰 가운과 목에 걸린 청진기",
    "검은 정장 조끼까지 갖춘 쓰리피스 턱시도와 검은 보타이", "어두운 오버사이즈 후드와 검은 카고 팬츠, 깨끗한 흰 스니커즈", "낡은 회색 재킷과 와이드 핏 라이트 그레이 팬츠, 흰 운동화",
    "검은 가죽 재킷에 몸에 붙는 검은 티셔츠, 두툼한 검은 가죽 부츠", "큼직한 흰 맨투맨과 라임색 와이드 데님, 라임색 스니커즈", "빈티지 체크 스카프와 모직 베스트",
    "광택 있는 은빛 점프수트", "자수가 놓인 데님 재킷과 롱 플리츠 스커트", "작업복 점프수트와 낡은 가죽 벨트",
    "흰 셔츠 소매를 걷고 멜빵을 한 차림", "겨울용 두꺼운 털 후드 파카와 털장갑", "단정한 베이지 니트 가디건과 흰 셔츠",
    "붉은 새틴 드레스와 긴 검은 장갑", "검은 가죽 바지와 크롭 재킷", "한복 두루마기와 갓",
    "형광 포인트가 들어간 러닝 재킷과 타이츠", "크림색 롱 카디건과 헐렁한 청바지", "어두운 녹색 코듀로이 재킷과 터틀넥",
    "셔츠 위에 겹쳐 입은 오버사이즈 블레이저와 은색 손목시계", "빛바랜 밴드 티셔츠와 찢어진 청바지", "순백의 드레스와 얇은 베일",
    "비즈니스 캐주얼 회색 정장과 로퍼"
  ],
  expression: [
    "고요하고 자신감 있는 표정으로 카메라를 정면으로 바라본다", "살짝 미소 지으며 시선을 비스듬히 둔다", "깊은 생각에 잠겨 먼 곳을 본다", "활짝 웃으며 눈가에 주름이 잡힌다", "무표정하지만 눈빛이 강렬하다",
    "눈을 내리깔고 조용히 아래를 본다", "장난기 어린 윙크", "놀란 듯 눈을 크게 뜬다", "입술을 살짝 다문 신비로운 표정", "그리움이 어린 쓸쓸한 눈빛", "고개를 살짝 기울이고 호기심 어린 표정",
    "피곤하지만 편안한 얼굴", "단호하고 결연한 표정", "카메라를 보지 않고 다른 곳에 시선을 두는 자연스러운 모습",
    "살짝 비꼬는 듯한 여유로운 미소", "진지하고 자신감이 넘치는 도도한 표정", "눈을 가늘게 뜨고 먼 곳을 본다",
    "어깨 너머로 카메라를 돌아보며 은근히 웃는다", "웃음을 참는 듯 입꼬리가 씰룩인다", "차분하게 입술을 다물고 눈을 마주친다",
    "하품을 참는 졸린 표정", "눈물이 맺힌 듯 촉촉한 눈", "뿌듯함이 묻어나는 환한 미소",
    "한쪽 눈썹만 올린 의아한 표정", "눈을 감고 평온하게 숨을 내쉰다", "카메라를 정면으로 응시하며 아무 말 없이 서 있다",
    "무언가에 집중한 진지한 옆얼굴", "수줍게 시선을 피하며 웃는다"
  ],
  action: [
    "창밖을 바라보며 서 있다", "우산을 쓰고 천천히 걸어간다", "책을 펼쳐 읽고 있다", "카메라를 향해 살짝 웃는다", "멀리 있는 무언가를 가리킨다", "벤치에 앉아 따뜻한 차를 마신다", "뒤돌아보며 손을 흔든다", "눈을 감고 바람을 느낀다",
    "계단에 앉아 한쪽 팔로 턱을 괸다", "벽에 기대어 팔짱을 낀다", "자전거를 끌고 걷는다", "달리다가 멈춰 숨을 고른다", "손으로 머리카락을 쓸어 넘긴다", "무릎을 꿇고 바닥의 무언가를 살핀다",
    "양손을 주머니에 넣고 천천히 걷는다", "커피잔을 두 손으로 감싸 쥐고 있다", "높은 곳의 난간에 팔을 걸치고 아래를 내려다본다", "노트에 무언가를 적고 있다", "꽃을 한 송이 들고 향기를 맡는다", "의자에 깊이 기대어 다리를 꼰다",
    "두 팔을 활짝 벌리고 서 있다", "고개를 숙이고 신발 끈을 묶는다", "창가에 앉아 턱을 괴고 있다", "멀리서 다가오며 카메라를 향해 걷는다",
    "운전석에 앉아 한 손은 핸들에, 다른 손으로 턱을 괸다", "양쪽 팔꿈치를 무릎에 올리고 두 손을 느슨하게 늘어뜨린다", "차에 기대어 한쪽 다리를 다른 쪽 위에 꼬고 선다",
    "오토바이 뒷좌석에 걸터앉아 카메라를 슬쩍 본다", "레드카펫 위를 당당하게 걸으며 한 손을 흔든다", "손에 든 음료 캔을 높이 들어 건배한다",
    "두 손으로 햄버거를 입에 가져간다", "귀엽게 서로 어깨를 맞대고 포즈를 취한다", "큰 쿠션 의자에 푹 기대어 앉는다",
    "계단을 두 칸씩 뛰어 올라간다", "난간에 기대어 막대사탕을 입에 문다", "바닥에 앉아 무릎을 모으고 먼 곳을 본다",
    "자전거 위에서 한 발을 땅에 짚고 멈춰 있다", "코트 깃을 세우고 바람을 맞으며 걷는다", "팔을 뻗어 셀카를 찍는다",
    "양손에 든 짐을 들고 문을 어깨로 민다", "기타를 안고 조용히 코드를 짚는다", "창문 앞에 서서 커튼을 살짝 젖힌다",
    "한 손으로 모자 챙을 잡고 고개를 숙인다", "서로 등을 맞대고 서 있다"
  ],
  place: [
    "비 오는 밤의 좁은 골목", "해 질 녘의 한적한 바닷가", "오래된 도서관의 높은 서가 사이", "눈 덮인 숲속 오솔길", "새벽의 텅 빈 지하철 승강장", "햇살이 들어오는 작은 카페", "안개 낀 산 능선", "붐비는 시장 한가운데",
    "도심 건물 입구 앞의 낮은 돌계단", "네온 간판이 번지는 늦은 밤의 도시 교차로", "잡초가 무성한 들판", "낡은 철도 위", "빛이 스며드는 오래된 성당 내부", "깨끗한 흰 벽의 미니멀한 스튜디오",
    "어두운 회색 배경의 무광 스튜디오", "이끼 낀 돌담이 이어진 골목길", "수증기가 오르는 새벽의 온천 마을", "파도가 부서지는 절벽 위", "빈티지 소품이 가득한 작은 골동품 가게", "옥상에서 내려다보이는 도시 야경",
    "비행기 창가의 좌석", "빨래가 널린 오래된 주택가 옥상", "벚꽃이 흩날리는 강변 산책로", "붉게 물든 단풍 숲길", "사막 한가운데의 낡은 주유소", "유리 온실 속의 식물들 사이",
    "어두운 그라데이션 배경의 스튜디오, 둥근 검은 빈백 의자", "창밖으로 도시 풍경이 지나가는 빈티지 자동차 안 운전석", "벨벳 로프와 사진기자들의 플래시가 터지는 레드카펫",
    "야자수 실루엣이 걸린 주황과 보라빛 도시 노을 아래의 길", "라임색 하나로 통일한 미래적인 스튜디오", "무광 검은색 스포츠 오토바이 옆의 어두운 차고",
    "흰 커튼이 드리워진 방 안, 정면에서 터지는 플래시", "비에 젖은 네온 불빛의 새벽 편의점 앞", "오래된 극장의 붉은 벨벳 객석",
    "바람에 흔들리는 갈대밭 한가운데", "수천 개의 책이 쌓인 고서점 안", "공사 중인 건물 옥상의 철골 사이",
    "한적한 시골 버스 정류장", "얕은 물이 고인 소금 평원", "창문이 큰 현대적인 갤러리의 하얀 전시실",
    "기차 객실 창가 자리", "크리스마스 조명이 반짝이는 시장 골목", "연기가 자욱한 재즈 클럽 무대 뒤",
    "이끼 낀 고대 신전 폐허", "낡은 철제 계단이 있는 공장 지대", "하늘이 비치는 얕은 해변",
    "안개 낀 이른 아침의 호숫가 선착장", "파스텔톤 벽이 이어진 지중해풍 골목", "눈 쌓인 산장의 벽난로 앞"
  ],
  time: [
    "이른 새벽, 푸르스름한 빛", "맑은 이른 아침", "따뜻한 늦은 오후의 황금빛 시간", "해 질 녘 노을", "푸른 시간(해가 진 직후)", "깊은 밤", "흐린 날의 부드러운 낮", "비가 내리는 날",
    "안개가 자욱한 아침", "눈이 소복이 내리는 날", "한여름의 쨍한 한낮", "바람이 센 가을날", "보슬비가 그친 직후의 젖은 거리", "달빛이 밝은 밤",
    "어두운 방 안에서 정면으로 터지는 카메라 플래시", "비 갠 뒤 구름 사이로 햇살이 비치는 오후", "한밤중 가로등 아래",
    "노을이 주황과 보라로 번지는 해 질 녘", "구름 낀 이른 아침의 차가운 푸른빛", "해가 중천에 뜬 맑은 한낮",
    "첫눈이 내리는 저녁", "어슴푸레한 새벽 안개", "무더운 한여름 밤",
    "소나기가 퍼붓는 오후", "봄바람에 꽃잎이 날리는 아침", "낙엽이 바람에 쓸리는 늦가을 오후"
  ],
  camera: [
    "무릎 위까지 담은 프레임, 로우 앵글, 인물용 중망원 렌즈, 얕은 심도", "얼굴을 크게 담은 클로즈업, 85mm 렌즈, 배경은 부드럽게 흐림", "전신이 보이는 와이드 샷, 인물이 작게 보이는 구도", "정면에서 눈높이로 찍은 반신 샷",
    "위에서 내려다보는 하이 앵글", "측면 옆모습 샷", "뒤에서 따라가며 찍은 어깨 너머 샷", "35mm 스트리트 사진 느낌의 자연스러운 스냅", "대칭 구도의 정면 샷", "인물을 프레임 한쪽에 두고 넓은 여백을 남긴 구도",
    "어안렌즈처럼 과장된 원근감", "망원 렌즈로 압축된 배경", "바닥에 가깝게 낮춘 카메라, 땅에서 올려다보는 시점", "살짝 기울인 더치 앵글", "유리창 너머로 찍은 듯한 겹친 프레임", "배경을 크게 흐리게 한 아주 얕은 심도의 상반신 샷",
    "카메라를 조금 높여 무릎 위부터 머리까지 담은 프레임", "아래에서 올려다보는 로우 앵글 클로즈업", "전신이 보이는 풀 샷, 배경이 인물을 감싸는 구도",
    "정사각형 1:1 구도의 상반신 샷", "한쪽으로 치우쳐 시선 방향에 여백을 둔 구도", "어깨 너머로 인물과 풍경을 함께 담은 샷",
    "창틀을 프레임으로 활용한 구도", "인물의 눈에 초점을 맞추고 나머지는 흐리게 한 극단적 클로즈업", "광각 렌즈로 가까이에서 과장되게 담은 사진",
    "항공 시점에서 내려다본 전신 샷", "카메라가 약간 흔들린 듯한 스냅 사진", "흐릿하게 지나가는 배경과 또렷한 인물의 팬닝 샷",
    "거울에 비친 모습을 담은 구도", "두 사람을 프레임 가운데 맞대어 담은 구도", "정면에서 수평으로 찍은 정직한 증명사진풍 구도",
    "멀리서 인물을 작게 담고 배경을 크게 보여주는 구도"
  ],
  lighting: [
    "따뜻하고 부드럽게 퍼지는 빛으로 얼굴과 상체를 감싼다", "한쪽에서 들어오는 강한 사이드 라이트, 짙은 그림자", "렘브란트 조명, 뺨에 삼각형 빛", "창가의 부드러운 자연광", "골든 아워의 역광, 머리카락 윤곽에 빛이 번진다",
    "네온 간판이 만드는 분홍과 청록의 이색 조명", "차가운 푸른 달빛", "스튜디오의 은은한 스트로브 조명, 배경에는 미세한 그라데이션", "고대비 흑백 조명", "촛불처럼 따뜻한 낮은 조도",
    "흐린 날의 부드럽고 그림자 없는 빛", "나뭇잎 사이로 스며드는 빛 줄기", "가로등의 노란 불빛과 젖은 노면의 반사", "아래에서 올라오는 어두운 조명", "투명한 햇살과 선명한 그림자", "형광등 아래의 차갑고 평평한 빛",
    "얼굴과 상체만 비추고 배경은 어둠에 묻히는 극적인 방향성 조명", "피부와 옷감의 질감을 부드럽게 살리는 시네마틱한 글로우", "정면에서 터지는 날 것의 플래시 조명, 뒤쪽으로 그림자가 떨어진다",
    "창문으로 스며드는 부드러운 낮의 자연광", "붉은 노을빛이 만드는 네오누아르 분위기의 색 대비", "상단에서 내리꽂는 좁은 스포트라이트",
    "푸른색과 주황색 두 가지 색 조명이 얼굴 양쪽을 나눠 비춘다", "무대 조명처럼 선명한 컬러 젤 조명", "천을 통과한 은은한 확산광",
    "반사판으로 아래에서 살짝 받쳐 올린 부드러운 보조광", "촛불 하나로 밝힌 어둑한 실내", "안개 속에서 번지는 자동차 헤드라이트 빛",
    "실루엣만 보이는 강한 역광", "눈 덮인 땅이 반사하는 차갑고 밝은 빛"
  ],
  palette: [
    "흑백, 정제된 대비", "라임색과 흰색의 산뜻한 조합", "채도를 낮춘 회색과 흰색, 검정의 균형",
    "주황과 보라의 노을 색감", "따뜻한 갈색과 황금빛", "차가운 청록과 푸른 계열",
    "파스텔 핑크와 하늘색", "한 가지 색조로 통일된 모노크롬", "선명한 원색 대비",
    "바랜 세피아 톤", "짙은 에메랄드와 검정", "붉은색 포인트만 도드라지는 무채색",
  ],
  style: [
    "필름 사진 느낌의 따뜻한 색감", "수채화 일러스트", "시네마틱 영화 스틸, 얕은 심도", "부드러운 파스텔톤 애니메이션 배경 그림", "흑백 다큐멘터리 사진", "유화 질감의 고전 회화풍", "네온 빛이 번지는 사이버펑크 야경 사진", "고요한 미니멀 사진, 넓은 여백",
    "하이패션 에디토리얼 사진, 다듬어진 피부 질감", "어둡고 분위기 있는 무디한 인물 사진", "흑백 시네마틱 인물 사진, 정제된 대비", "35mm 필름의 거친 입자와 약간 바랜 색", "폴라로이드 스냅 느낌", "잉크와 펜으로 그린 선화에 연한 채색",
    "고급스러운 스튜디오 제품 사진", "스튜디오 지브리풍의 따뜻한 애니메이션", "빈티지 포스터 일러스트", "3D 렌더링처럼 매끈한 입체 인물", "실사에 가까운 극사실 사진", "컨셉 아트 느낌의 장대한 풍경화",
    "폴라로이드로 찍은 듯한 약간 흐릿한 스냅 사진", "바랜 색감과 거친 입자의 향수 어린 빈티지 사진", "비디오 게임 아트 같은 과장된 스타일의 일러스트",
    "하이패션 에디토리얼과 미래적인 감각의 혼합", "고대비 스튜디오 인물 사진", "고딕 판타지 분위기의 스튜디오 초상",
    "로모 카메라로 찍은 듯한 비네팅과 색 번짐", "일본 애니메이션 배경 미술 같은 선명한 구름과 하늘", "목탄으로 그린 거친 드로잉",
    "70년대 영화 포스터 같은 거친 인쇄 질감", "클레이 애니메이션 같은 손으로 빚은 질감", "저채도 필름 누아르 스틸",
    "미니어처 모형처럼 보이는 틸트 시프트 사진", "우키요에풍 선과 평면적인 색", "스케치와 수채가 섞인 여행 일기 그림",
    "하이퍼리얼리즘, 피부와 천의 질감이 극도로 선명한 사진"
  ],
  prop: [
    "낡은 우산", "빛바랜 사진 한 장", "작은 손전등", "김이 오르는 머그잔", "오래된 카메라", "접힌 종이 지도", "둥글고 반사되는 선글라스", "손으로 쓴 편지", "낡은 가죽 가방", "작은 화분", "오래된 라디오", "종이 커피잔",
    "빈티지 자전거", "꽃다발", "손목시계", "헤드폰", "열쇠 꾸러미", "낡은 책 몇 권", "기타", "펼쳐진 스케치북",
    "스포츠 핸들이 달린 클래식 카", "크롬 휠이 반짝이는 로우라이더 차", "무광 검은색 스포츠 오토바이",
    "둥글고 큼직한 검은 빈백 의자", "금빛 트로피", "붉은 음료 캔",
    "한입 베어 문 햄버거", "은색 손목시계", "둥근 선글라스",
    "낡은 트렁크 가방", "종이 우산", "작은 모래시계",
    "하얀 천 커튼", "오래된 전화기", "손에 든 필름 카메라",
    "꽃무늬 보자기", "한 권의 시집", "금이 간 거울",
    "붉은 장미 한 송이", "크림이 올라간 케이크 한 조각"
  ],
};

const MAX_WEIGHT = 100;

/** Phrases as { text, weight }: a plain string is a phrase of weight 1; blank and repeated texts are dropped (the first one counts). */
function clean(list) {
  const seen = new Set();
  const out = [];
  for (const item of Array.isArray(list) ? list : []) {
    const text = (typeof item === "string" ? item : item?.text);
    if (typeof text !== "string" || !text.trim() || seen.has(text.trim())) continue;
    const weight = typeof item === "string" || item.weight === undefined ? 1 : Number(item.weight);
    if (!Number.isFinite(weight) || weight < 0 || weight > MAX_WEIGHT) throw new HttpError(400, `가중치는 0~${MAX_WEIGHT} 사이여야 합니다: ${text.trim().slice(0, 30)}`);
    seen.add(text.trim());
    // `for` (optional): the phrase is only for this gender (the text of a phrase of the "gender" category); without it it fits every one.
    const gender = typeof item === "object" && typeof item.for === "string" ? item.for.trim().slice(0, 20) : "";
    out.push({ text: text.trim(), weight, ...(gender ? { for: gender } : {}) });
  }
  return out;
}

/** The built-in pool in the shape of a saved one. */
export const defaultPool = () => ({ categories: POOL_CATEGORIES.map(({ id, label }) => ({ id, label, phrases: clean(DEFAULT_POOL[id]) })) });

/**
 * Checks a pool from the screen or a file: { categories: [{ id?, label, phrases }] } in the order to show.
 * A category without an id gets one; an empty category is allowed (it is skipped when mixing). The old shape { person: [...], ... } is still read.
 */
export function checkPool(input) {
  if (input === null || typeof input !== "object" || Array.isArray(input)) throw new HttpError(400, "풀은 항목별 문구 목록이어야 합니다.");
  const list = Array.isArray(input.categories) ? input.categories : POOL_CATEGORIES.filter(({ id }) => id in input).map(({ id, label }) => ({ id, label, phrases: input[id] }));
  if (!Array.isArray(input.categories) && Object.keys(input).some((key) => !POOL_CATEGORIES.some(({ id }) => id === key))) throw new HttpError(400, "알 수 없는 항목이 있습니다.");
  if (list.length > MAX_CATEGORIES) throw new HttpError(400, `항목은 ${MAX_CATEGORIES}개 이하여야 합니다.`);
  const used = new Set();
  const categories = list.map((item, index) => {
    if (item === null || typeof item !== "object") throw new HttpError(400, `${index + 1}번째 항목이 올바르지 않습니다.`);
    const label = typeof item.label === "string" ? item.label.trim() : "";
    if (!label || label.length > 20) throw new HttpError(400, `${index + 1}번째 항목의 이름은 1~20자여야 합니다.`);
    let id = typeof item.id === "string" && item.id ? item.id : "";
    if (id && !/^[a-z0-9_-]{1,30}$/.test(id)) throw new HttpError(400, `항목 id가 올바르지 않습니다: ${id}`);
    if (!id) for (let n = index + 1; !id; n += 1) if (!used.has(`c${n}`) && !list.some((other) => other?.id === `c${n}`)) id = `c${n}`;
    if (used.has(id)) throw new HttpError(400, `항목 id가 겹칩니다: ${id}`);
    used.add(id);
    const phrases = clean(item.phrases);
    if (phrases.length > MAX_PHRASES || phrases.some((phrase) => phrase.text.length > MAX_LENGTH)) throw new HttpError(400, `${label}: 문구는 ${MAX_PHRASES}개 이하, 각 ${MAX_LENGTH}자 이하여야 합니다.`);
    return { id, label, phrases };
  });
  if (categories.every((category) => category.phrases.every((phrase) => phrase.weight === 0))) throw new HttpError(400, "가중치가 0보다 큰 문구가 하나 이상 있어야 합니다.");
  return { categories };
}

export async function readPool(file) {
  try {
    return checkPool(JSON.parse((await readFile(file, "utf8")).replace(/^﻿/, "")));
  } catch (error) {
    if (error.code === "ENOENT") return defaultPool();
    throw new HttpError(500, `이미지 풀 파일을 읽지 못했습니다: ${error.message}`);
  }
}

export async function writePool(file, input) {
  const pool = checkPool(input);
  await writeFileAtomic(file, `${JSON.stringify(pool, null, 2)}\n`);
  return pool;
}

/** Whether a phrase may be used with this gender ("" = no gender known: every phrase fits). */
const fits = (phrase, gender) => !gender || !phrase.for || phrase.for === gender;

/** One phrase by weight (a weight of 0 is never drawn); null when nothing can be drawn. */
function draw(phrases, random) {
  const total = phrases.reduce((sum, phrase) => sum + phrase.weight, 0);
  if (total <= 0) return null;
  let at = random() * total;
  for (const phrase of phrases) {
    at -= phrase.weight;
    if (at < 0) return phrase;
  }
  return phrases.findLast((phrase) => phrase.weight > 0);
}

/**
 * `count` combinations, one phrase per category (a category without a drawable phrase is left out). `locked` = { category id: phrase } is kept in every one.
 * Phrases are drawn by weight; the phrases of one category differ between the combinations until the category runs out of them.
 */
export function pickCombinations(pool, { count = 1, locked = {}, random = Math.random } = {}) {
  const wanted = Math.min(24, Math.max(1, Math.floor(Number(count)) || 1));
  const left = Object.fromEntries(pool.categories.map(({ id, phrases }) => [id, [...phrases]]));
  const take = ({ id, phrases }, gender) => {
    if (!left[id].some((phrase) => phrase.weight > 0 && fits(phrase, gender))) left[id] = [...phrases];
    const phrase = draw(left[id].filter((item) => fits(item, gender)), random);
    if (!phrase) return null;
    left[id] = left[id].filter((item) => item !== phrase);
    return phrase.text;
  };
  const genderCategory = pool.categories.find((category) => category.id === "gender");
  return Array.from({ length: wanted }, () => {
    // The gender is drawn first: phrases made for the other gender are left out of the rest of the combination.
    const gender = locked.gender || (genderCategory ? take(genderCategory, "") : "");
    return Object.fromEntries(pool.categories.map((category) => [category.id, category.id === "gender" ? gender : locked[category.id] || take(category, gender)]).filter(([, text]) => text));
  });
}

/** One category of one combination again (the screen's dice button), by weight. */
export function pickOne(pool, id, { avoid = "", gender = "", random = Math.random } = {}) {
  const category = pool.categories.find((item) => item.id === id);
  if (!category) throw new HttpError(400, "알 수 없는 항목입니다.");
  const usable = category.phrases.filter((item) => fits(item, gender));
  const phrase = draw(usable.filter((item) => item.text !== avoid), random) ?? draw(usable, random);
  if (!phrase) throw new HttpError(400, "이 항목에는 뽑을 문구가 없습니다.");
  return phrase.text;
}
