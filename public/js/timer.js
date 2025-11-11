// public/js/timer.js
window.addEventListener('load', () => {
  const timerElement = document.getElementById('timer');
  const examForm = document.getElementById('exam-form');

  if (!timerElement || !examForm) {
    console.error("Không tìm thấy timer hoặc form.");
    return;
  }

  // Lấy thời gian kết thúc từ server (startTime + timeLimit)
  // startTime và timeLimitInSeconds được truyền từ exam.ejs
  const endTime = startTime + (timeLimitInSeconds * 1000);

  const timerInterval = setInterval(() => {
    const now = Date.now();
    const timeLeft = Math.round((endTime - now) / 1000);

    if (timeLeft <= 0) {
      clearInterval(timerInterval);
      timerElement.textContent = "HẾT GIỜ";
      
      // Tự động nộp bài
      alert("Đã hết thời gian làm bài. Bài thi sẽ được nộp tự động.");
      
      // Thêm một trường ẩn "action=finish" vào form và submit
      const finishInput = document.createElement('input');
      finishInput.type = 'hidden';
      finishInput.name = 'action';
      finishInput.value = 'finish';
      examForm.appendChild(finishInput);
      
      examForm.submit();
      
    } else {
      const minutes = Math.floor(timeLeft / 60);
      const seconds = timeLeft % 60;
      timerElement.textContent = `${minutes}:${seconds < 10 ? '0' : ''}${seconds}`;
    }
  }, 1000);
});