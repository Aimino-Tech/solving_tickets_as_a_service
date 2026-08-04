/**
 * SYNTARO — Main Application Script
 * Handles: Mobile nav toggle, FAQ accordion, animations, Plausible analytics
 */

(function () {
  'use strict';

  // --- Mobile Navigation Toggle ---
  const navToggle = document.getElementById('navToggle');
  const navLinks = document.getElementById('navLinks');

  if (navToggle && navLinks) {
    navToggle.addEventListener('click', function () {
      navLinks.classList.toggle('open');
      navToggle.setAttribute('aria-expanded', navLinks.classList.contains('open'));
    });

    // Close nav on link click (mobile)
    navLinks.querySelectorAll('a').forEach(function (link) {
      link.addEventListener('click', function () {
        navLinks.classList.remove('open');
        navToggle.setAttribute('aria-expanded', 'false');
      });
    });
  }

  // --- Set active nav link based on current page ---
  const currentPath = window.location.pathname;
  document.querySelectorAll('.nav-links a').forEach(function (link) {
    const href = link.getAttribute('href');
    if (href === currentPath || (currentPath === '/' && href === '/')) {
      link.classList.add('active');
    } else if (href !== '/' && href !== '#' && currentPath.startsWith(href)) {
      link.classList.add('active');
    }
  });

  // --- FAQ Accordion ---
  document.querySelectorAll('.faq-question').forEach(function (btn) {
    btn.addEventListener('click', function () {
      const answer = this.nextElementSibling;
      const isOpen = answer.classList.contains('open');

      // Close all
      document.querySelectorAll('.faq-answer.open').forEach(function (a) {
        a.classList.remove('open');
        a.previousElementSibling.classList.remove('open');
      });

      // Toggle current
      if (!isOpen) {
        answer.classList.add('open');
        this.classList.add('open');
      }
    });
  });

  // --- Scroll-triggered animations ---
  const animateElements = document.querySelectorAll('.animate-on-scroll');

  function checkVisibility() {
    animateElements.forEach(function (el) {
      const rect = el.getBoundingClientRect();
      const isVisible = rect.top < window.innerHeight - 60;
      if (isVisible) {
        el.classList.add('animate-in');
      }
    });
  }

  if (animateElements.length > 0) {
    window.addEventListener('scroll', checkVisibility);
    window.addEventListener('resize', checkVisibility);
    checkVisibility(); // Initial check
  }

  // --- Plausible Analytics ---
  // Loaded via <script> tag in HTML, but set up custom events here
  window.plausible = window.plausible || function () {
    (window.plausible.q = window.plausible.q || []).push(arguments);
  };

  // Track outbound links
  document.addEventListener('click', function (e) {
    var link = e.target.closest('a');
    if (link && link.hostname !== window.location.hostname && link.href.startsWith('http')) {
      window.plausible('Outbound Link: Click', { props: { url: link.href } });
    }
  });

  // Track CTA clicks
  document.querySelectorAll('[data-track]').forEach(function (el) {
    el.addEventListener('click', function () {
      window.plausible('CTA: Click', { props: { label: this.getAttribute('data-track') } });
    });
  });

  // --- Smooth scroll for anchor links ---
  document.querySelectorAll('a[href^="#"]').forEach(function (anchor) {
    anchor.addEventListener('click', function (e) {
      const target = document.querySelector(this.getAttribute('href'));
      if (target) {
        e.preventDefault();
        target.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    });
  });

  console.log('SYNTARO website initialized');
})();
