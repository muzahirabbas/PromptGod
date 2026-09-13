// Listen for messages from the content script to update the modal's HTML
window.addEventListener("message", (event) => {
    if (event.data && event.data.type === "PROMPTGOD_UPDATE_MODAL") {
        const contentDiv = document.getElementById('promptgod-modal-content');
        if (contentDiv) {
            contentDiv.innerHTML = event.data.html;
            
            // Focus first button if available
            setTimeout(() => {
                const firstBtn = document.querySelector('.promptgod-button');
                if (firstBtn) {
                    firstBtn.focus();
                    firstBtn.classList.add('focused');
                } else {
                    document.getElementById('promptgod-modal').focus();
                }
            }, 50);
        }
    }
});

function closeAndNotify() {
    window.parent.postMessage({ type: 'PROMPTGOD_CLOSE_MODAL' }, '*');
}

// Handle clicks
document.addEventListener('click', (event) => {
    if (event.target.closest('.promptgod-button')) {
        const btn = event.target.closest('.promptgod-button');
        const selectedFunction = btn.dataset.function;
        window.parent.postMessage({
            type: 'PROMPTGOD_BUTTON_CLICK',
            payload: selectedFunction
        }, '*');
    }

    if (event.target.id === 'promptgod-overlay' || event.target.closest('#promptgod-close')) {
        closeAndNotify();
    }
});

// Keyboard navigation
document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
        closeAndNotify();
        return;
    }
    
    // Basic arrow key navigation for buttons
    if (event.key === 'ArrowRight' || event.key === 'ArrowLeft' || event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        const buttons = Array.from(document.querySelectorAll('.promptgod-button'));
        if (buttons.length === 0) return;
        
        const currentIndex = buttons.findIndex(b => b === document.activeElement || b.classList.contains('focused'));
        let nextIndex = 0;
        
        if (currentIndex !== -1) {
            buttons[currentIndex].classList.remove('focused');
            if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
                nextIndex = (currentIndex + 1) % buttons.length;
            } else {
                nextIndex = (currentIndex - 1 + buttons.length) % buttons.length;
            }
        }
        
        buttons[nextIndex].focus();
        buttons[nextIndex].classList.add('focused');
        event.preventDefault();
    }
});

// Handle focus styles
document.addEventListener('focusin', (event) => {
    if (event.target.classList.contains('promptgod-button')) {
        document.querySelectorAll('.promptgod-button').forEach(b => b.classList.remove('focused'));
        event.target.classList.add('focused');
    }
});