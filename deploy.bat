@echo off
chcp 65001 >nul
echo =======================================
echo  eulim-portfolio Vercel 배포 스크립트
echo  (eulim.vercel.app 프로덕션 반영)
echo =======================================
echo.

REM Vercel 토큰이 없으면 입력 받기
if "%VERCEL_TOKEN%"=="" (
  set /p VERCEL_TOKEN="Vercel 토큰을 입력하세요 (vercel.com/account/tokens): "
)

REM 이 배치 파일이 있는 폴더로 이동
cd /d "%~dp0"

REM 기존 eulim-portfolio 프로젝트에 연결 (새 프로젝트 생성 방지)
call npx vercel link --yes --project eulim-portfolio --scope aneulim-6202s-projects --token %VERCEL_TOKEN%

REM 프로덕션 배포
call npx vercel --prod --yes --scope aneulim-6202s-projects --token %VERCEL_TOKEN%

echo.
echo 배포 완료! https://eulim.vercel.app 에서 확인하세요.
pause
