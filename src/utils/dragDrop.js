export function enableAgendaDragAndDrop({ itemSelector = ".agenda-appointment", containerSelector = ".drop-zone", onDrop = () => {} }) {
  let draggedItem = null
  const placeholder = document.createElement("div")
  placeholder.className = "drag-placeholder"

  const init = () => {
    document.querySelectorAll(itemSelector).forEach(item => {
      item.setAttribute("draggable", true)
      item.addEventListener("dragstart", (e) => {
        draggedItem = item; item.classList.add("dragging")
        e.dataTransfer.setData('text/plain', item.dataset.id); e.dataTransfer.effectAllowed = 'move'
        placeholder.style.height = `${item.offsetHeight}px`; setTimeout(() => item.style.display = "none", 0)
      })
      item.addEventListener("dragend", () => { item.classList.remove("dragging"); item.style.display = "block"; placeholder.remove(); draggedItem = null })
    })

    document.querySelectorAll(containerSelector).forEach(container => {
      container.addEventListener("dragover", (e) => {
        e.preventDefault(); e.dataTransfer.dropEffect = 'move'
        if (!container.contains(placeholder) && draggedItem && !container.querySelector('.drag-placeholder')) container.appendChild(placeholder)
      })
      container.addEventListener("dragleave", (e) => { if (!container.contains(e.relatedTarget)) placeholder.remove() })
      container.addEventListener("drop", (e) => {
        e.preventDefault()
        if (draggedItem) {
          const target = e.currentTarget
          onDrop({
            appointmentId: parseInt(draggedItem.dataset.id),
            targetDate: target.dataset.date,
            targetHour: target.dataset.hour ? parseInt(target.dataset.hour) : null
          })
          placeholder.remove()
        }
      })
    })
  }
  init(); return init
}