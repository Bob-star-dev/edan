// Wait for the page to fully load
document.addEventListener('DOMContentLoaded', function() {
    // Get all elements
    const textarea = document.getElementById('textInput');
    const femaleVoice = document.querySelector('input[value="UK English Female"]');
    const maleVoice = document.querySelector('input[value="UK English Male"]');
    const rateControl = document.getElementById('rateControl');
    const speakBtn = document.getElementById('speakBtn');
    
    // Add click event to the "SAY IT" button
    speakBtn.addEventListener('click', function() {
        // Get text from textarea
        let text = textarea.value || 'Hello, Codepen!';
        
        // Get selected voice
        let voice = femaleVoice.checked ? femaleVoice.value : maleVoice.value;
        
        // Get rate (speed) value
        let rate = rateControl.value;
        
        // Speak the text with selected voice and rate
        responsiveVoice.speak(text, voice, { rate: rate });
    });
    
    // Allow Enter key to trigger speech (when holding Ctrl)
    textarea.addEventListener('keydown', function(e) {
        if (e.ctrlKey && e.key === 'Enter') {
            speakBtn.click();
        }
    });
});

// Reference: https://code.responsivevoice.org/responsivevoice.js