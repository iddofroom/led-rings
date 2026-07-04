import React, { useState, useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { useI18n } from '../lib/i18n'
import './RingSelector.css'

interface RingSelectorProps {
  rings: number[]
  onChange: (rings: number[]) => void
}

const RingSelector = ({ rings, onChange }: RingSelectorProps) => {
  const [isExpanded, setIsExpanded] = useState(false)
  const [panelPosition, setPanelPosition] = useState({ top: 0, left: 0 })
  const panelRef = useRef<HTMLDivElement>(null)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const allRings = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]
  const { t } = useI18n()

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(event.target as Node) &&
          buttonRef.current && !buttonRef.current.contains(event.target as Node)) {
        setIsExpanded(false)
      }
    }

    if (isExpanded && buttonRef.current) {
      const updatePosition = () => {
        if (buttonRef.current && panelRef.current) {
          const buttonRect = buttonRef.current.getBoundingClientRect()
          const panelRect = panelRef.current.getBoundingClientRect()
          const viewportWidth = window.innerWidth
          const viewportHeight = window.innerHeight
          
          let top = buttonRect.bottom + 4
          let left = buttonRect.left
          
          // Adjust if panel would go off bottom of screen
          if (top + panelRect.height > viewportHeight) {
            top = buttonRect.top - panelRect.height - 4
          }
          
          // Adjust if panel would go off right side of screen
          if (left + panelRect.width > viewportWidth) {
            left = viewportWidth - panelRect.width - 10
          }
          
          // Adjust if panel would go off left side of screen
          if (left < 10) {
            left = 10
          }
          
          setPanelPosition({ top, left })
        } else if (buttonRef.current) {
          // Initial position before panel is rendered
          const rect = buttonRef.current.getBoundingClientRect()
          setPanelPosition({
            top: rect.bottom + 4,
            left: rect.left
          })
        }
      }
      
      // Use requestAnimationFrame to ensure DOM is updated
      requestAnimationFrame(() => {
        updatePosition()
      })
      
      window.addEventListener('scroll', updatePosition, true)
      window.addEventListener('resize', updatePosition)
      
      document.addEventListener('mousedown', handleClickOutside)
      return () => {
        document.removeEventListener('mousedown', handleClickOutside)
        window.removeEventListener('scroll', updatePosition, true)
        window.removeEventListener('resize', updatePosition)
      }
    }
  }, [isExpanded])

  const toggleRing = (ring: number, e: React.MouseEvent) => {
    e.stopPropagation()
    if (rings.includes(ring)) {
      onChange(rings.filter(r => r !== ring))
    } else {
      onChange([...rings, ring].sort((a, b) => a - b))
    }
  }

  const quickSelect = (preset: string, e: React.MouseEvent) => {
    e.stopPropagation()
    let selectedRings: number[] = []
    switch (preset) {
      case 'all':
        selectedRings = allRings
        break
      case 'even':
        selectedRings = [2, 4, 6, 8, 10, 12]
        break
      case 'odd':
        selectedRings = [1, 3, 5, 7, 9, 11]
        break
      case 'left':
        selectedRings = [1, 2, 3, 4, 5, 6]
        break
      case 'right':
        selectedRings = [7, 8, 9, 10, 11, 12]
        break
      case 'center':
        selectedRings = [4, 5, 6, 7, 8, 9]
        break
      case 'outer':
        selectedRings = [1, 2, 3, 10, 11, 12]
        break
    }
    onChange(selectedRings)
  }

  useEffect(() => {
    if (containerRef.current) {
      const timeframe = containerRef.current.closest('.timeframe')
      if (timeframe) {
        if (isExpanded) {
          timeframe.classList.add('ring-selector-open')
        } else {
          timeframe.classList.remove('ring-selector-open')
        }
      }
    }
  }, [isExpanded])

  return (
    <div className="ring-selector" ref={containerRef}>
      <button
        ref={buttonRef}
        className="ring-selector-toggle"
        onClick={(e) => {
          e.stopPropagation()
          setIsExpanded(!isExpanded)
        }}
        title={t({ en: 'Select rings', he: 'בחר טבעות' })}
      >
        {t({ en: 'Rings', he: 'טבעות' })}: {rings.length === 12 ? t({ en: 'All', he: 'הכול' }) : rings.length === 0 ? t({ en: 'None', he: 'ללא' }) : rings.join(', ')}
        <span className={`ring-selector-arrow ${isExpanded ? 'expanded' : ''}`}>▼</span>
      </button>
      {isExpanded && createPortal(
        <div 
          className="ring-selector-panel" 
          ref={panelRef}
          style={{
            top: `${panelPosition.top}px`,
            left: `${panelPosition.left}px`
          }}
        >
          <div className="ring-quick-select">
            <button onClick={(e) => quickSelect('all', e)}>{t({ en: 'All', he: 'הכול' })}</button>
            <button onClick={(e) => quickSelect('even', e)}>{t({ en: 'Even', he: 'זוגי' })}</button>
            <button onClick={(e) => quickSelect('odd', e)}>{t({ en: 'Odd', he: 'אי-זוגי' })}</button>
            <button onClick={(e) => quickSelect('left', e)}>{t({ en: 'Left', he: 'שמאל' })}</button>
            <button onClick={(e) => quickSelect('right', e)}>{t({ en: 'Right', he: 'ימין' })}</button>
            <button onClick={(e) => quickSelect('center', e)}>{t({ en: 'Center', he: 'מרכז' })}</button>
            <button onClick={(e) => quickSelect('outer', e)}>{t({ en: 'Outer', he: 'חיצוני' })}</button>
          </div>
          <div className="ring-grid">
            {allRings.map(ring => (
              <button
                key={ring}
                className={`ring-button ${rings.includes(ring) ? 'active' : ''}`}
                onClick={(e) => toggleRing(ring, e)}
              >
                {ring}
              </button>
            ))}
          </div>
        </div>,
        document.body
      )}
    </div>
  )
}

export default RingSelector
