
    if ('serviceWorker' in navigator) {
      window.addEventListener('load', () => {
        navigator.serviceWorker.register('./sw.js').then(reg => {
          console.log('Service Worker Registrado: ', reg.scope);
        }).catch(err => {
          console.log('Fallo el registro del Service Worker: ', err);
        });
      });
    }
  

    function escapeHtml(value) {
      return String(value ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
    }
    lucide.createIcons();

    let map;
    let savedReports = [];
    let currentReportLocation = null;
    let currentReportType = "";
    
    // Variables para el modo verificación
    let activeViewingReportId = null;
    let activeVerifyReportId = null;
    let viewingMarker3D = null; // El marcador físico en Street View

    const reportIcons = {
      'Bache': { icon: 'triangle-alert', color: '#ff3b3b' },
      'Tráfico': { icon: 'car', color: '#f1c40f' },
      'Bloqueo': { icon: 'traffic-cone', color: '#e67e22' }
    };
    
    let activeMapMarkers = {}; // Para limpiar marcadores resueltos en el mapa
    
    db.onReportsSnapshot((reports) => {
      savedReports = reports;
      
      // Sincronizar UI de listas
      if (document.getElementById('screen-feed').style.display === 'block') {
        renderList('feed-list-container', false);
      } else if (document.getElementById('screen-profile').style.display === 'block' && isLoggedIn) {
        renderList('my-reports-list', true);
      }
      
      // Sincronizar Marcadores 3D del Mapa
      if (typeof map !== 'undefined') syncMapMarkers(reports);
      
      // Revisar si hay reportes que necesiten verificación de 8 horas
      checkVerifications();
    });

    function syncMapMarkers(reports) {
      // 1. Borrar marcadores que ya no existen (ej. resueltos)
      const currentIds = reports.map(r => r.id);
      Object.keys(activeMapMarkers).forEach(id => {
        if (!currentIds.includes(id)) {
          activeMapMarkers[id].setMap(null);
          delete activeMapMarkers[id];
        }
      });
      // 2. Crear los nuevos
      reports.forEach(report => {
        if (!activeMapMarkers[report.id]) {
          activeMapMarkers[report.id] = createMapMarker(report);
        }
      });
    }

    function createMapMarker(report) {
      const config = reportIcons[report.type] || reportIcons['Bache'];
      const markerDiv = document.createElement('div');
      markerDiv.className = 'custom-map-marker marker-' + (Object.hasOwn(reportIcons, report.type) ? report.type : 'Bache');
      markerDiv.innerHTML = `<i data-lucide="${config.icon}"></i>`;
      
      class CustomMarker extends google.maps.OverlayView {
        constructor(position, content) { super(); this.position = position; this.content = content; }
        onAdd() {
          this.getPanes().overlayMouseTarget.appendChild(this.content);
          this.content.addEventListener('click', (e) => {
            e.stopPropagation();
            openViewReportModal(report.id);
          });
          setTimeout(() => lucide.createIcons({ root: this.content }), 10);
        }
        draw() {
          const pos = this.getProjection().fromLatLngToDivPixel(this.position);
          this.content.style.position = 'absolute';
          this.content.style.left = (pos.x - 20) + 'px';
          this.content.style.top = (pos.y - 20) + 'px';
        }
        onRemove() { if(this.content.parentNode) this.content.parentNode.removeChild(this.content); }
      }
      const m = new CustomMarker(report.location, markerDiv);
      m.setMap(map);
      return m;
    }

    // ========================================================
    // CONTROLADOR DE STREET VIEW PROFESIONAL A TODO COLOR (IMAGEN 2)
    // ========================================================
    const CU_STREETS = [
      { name: "Pedro de Alba (FIME)", subtitle: "San Nicolás de los Garza, Nuevo León", lat: 25.72522, lng: -100.31346, heading: 270 },
      { name: "Av. Manuel L. Barragán", subtitle: "San Nicolás de los Garza, Nuevo León", lat: 25.72435, lng: -100.31720, heading: 90 },
      { name: "Av. Universidad (Entrada Principal)", subtitle: "San Nicolás de los Garza, Nuevo León", lat: 25.72890, lng: -100.31080, heading: 180 },
      { name: "Av. Fidel Velázquez (Paso a Desnivel)", subtitle: "San Nicolás de los Garza, Nuevo León", lat: 25.72150, lng: -100.31890, heading: 340 },
      { name: "Estadio Universitario de la UANL", subtitle: "San Nicolás de los Garza, Nuevo León", lat: 25.72480, lng: -100.31150, heading: 45 },
      { name: "Facultad de Ingeniería Mecánica y Eléctrica", subtitle: "Ciudad Universitaria, UANL", lat: 25.72550, lng: -100.31380, heading: 210 }
    ];

    let streetPanorama = null;
    let currentSVLocation = { lat: 25.72522, lng: -100.31346 };
    let currentSVHeading = 270;
    let svMinimapInstance = null;
    let svPegmanMarker = null;
    let isMinimapMinimized = false;

    function openStreetView(lat, lng, heading = 270, customTitle = null) {
      currentSVLocation = { lat, lng };
      currentSVHeading = heading;
      currentReportLocation = { lat, lng };

      // El visor nativo permite detectar el píxel pulsado sin bloquear la navegación.
      document.getElementById('streetview-wrapper').style.display = 'block';
      if (!streetPanorama) {
        streetPanorama = new google.maps.StreetViewPanorama(document.getElementById('sv-native'), {
          position: currentSVLocation, pov: { heading, pitch: 0 }, visible: true,
          disableDefaultUI: true, clickToGo: false, linksControl: true
        });
        streetPanorama.addListener('position_changed', () => {
          const pos = streetPanorama.getPosition();
          if (!pos) return;
          currentSVLocation = { lat: pos.lat(), lng: pos.lng() };
          currentReportLocation = currentSVLocation;
          updateLocationCard(pos.lat(), pos.lng());
          initOrUpdateMinimap(pos.lat(), pos.lng(), currentSVHeading);
        });
        streetPanorama.addListener('pov_changed', () => {
          currentSVHeading = streetPanorama.getPov().heading;
        });
      } else {
        streetPanorama.setPosition(currentSVLocation);
        streetPanorama.setPov({ heading, pitch: 0 });
        streetPanorama.setVisible(true);
      }

      // 2. Mostrar la interfaz de Street View y ocultar overlay del mapa general
      document.getElementById('streetview-wrapper').style.display = 'block';
      const mainOverlay = document.getElementById('main-map-overlay');
      if (mainOverlay) mainOverlay.style.display = 'none';

      document.getElementById('back-btn').style.display = 'flex';


      // 3. Actualizar la tarjeta de ubicación (Imagen 2)
      updateLocationCard(lat, lng, customTitle);

      // 4. Inicializar o centrar el Minimapa interactivo (Imagen 2)
      initOrUpdateMinimap(lat, lng, heading);

      lucide.createIcons();
    }

    function updateLocationCard(lat, lng, customTitle) {
      const titleEl = document.getElementById('sv-card-title');
      const subtitleEl = document.getElementById('sv-card-subtitle');

      if (customTitle) {
        titleEl.innerText = customTitle;
        subtitleEl.innerText = "San Nicolás de los Garza, Nuevo León";
        return;
      }

      // Buscar calle más cercana de CU
      let closest = CU_STREETS[0];
      let minDistance = 999999;
      CU_STREETS.forEach(street => {
        const d = Math.hypot(street.lat - lat, street.lng - lng);
        if (d < minDistance) {
          minDistance = d;
          closest = street;
        }
      });

      titleEl.innerText = closest.name;
      subtitleEl.innerText = closest.subtitle;
    }

    function initOrUpdateMinimap(lat, lng, heading) {
      const container = document.getElementById('sv-minimap-map');
      const pos = { lat, lng };

      if (!svMinimapInstance && typeof google !== 'undefined' && google.maps) {
        svMinimapInstance = new google.maps.Map(container, {
          center: pos,
          zoom: 17,
          mapTypeId: 'roadmap',
          disableDefaultUI: true,
          gestureHandling: 'greedy'
        });

        // Clic en el minimapa para cambiar la posición de Street View
        svMinimapInstance.addListener('click', (e) => {
          if (e.latLng) {
            openStreetView(e.latLng.lat(), e.latLng.lng(), currentSVHeading);
          }
        });
      } else if (svMinimapInstance) {
        svMinimapInstance.setCenter(pos);
      }

      // Actualizar marcador de Pegman en el minimapa
      if (svMinimapInstance) {
        if (!svPegmanMarker) {
          svPegmanMarker = new google.maps.Marker({
            position: pos,
            map: svMinimapInstance,
            title: "Tu ubicación en Street View",
            icon: {
              path: google.maps.SymbolPath.FORWARD_CLOSED_ARROW,
              scale: 6,
              fillColor: "#fbbc04",
              fillOpacity: 1,
              strokeWeight: 2,
              strokeColor: "#c5221f",
              rotation: heading
            }
          });
        } else {
          svPegmanMarker.setPosition(pos);
          const icon = svPegmanMarker.getIcon();
          if (icon) {
            icon.rotation = heading;
            svPegmanMarker.setIcon(icon);
          }
        }
      }
    }

    function toggleMinimap() {
      const wrapper = document.getElementById('sv-minimap-wrapper');
      const icon = document.getElementById('sv-minimap-toggle-icon');
      isMinimapMinimized = !isMinimapMinimized;

      if (isMinimapMinimized) {
        wrapper.classList.add('minimized');
        icon.setAttribute('data-lucide', 'maximize-2');
      } else {
        wrapper.classList.remove('minimized');
        icon.setAttribute('data-lucide', 'minimize-2');
        if (svMinimapInstance) {
          setTimeout(() => {
            google.maps.event.trigger(svMinimapInstance, 'resize');
            svMinimapInstance.setCenter(currentSVLocation);
          }, 250);
        }
      }
      lucide.createIcons();
    }

    function resetCompass() {
      currentSVHeading = 0;
      if (streetPanorama) streetPanorama.setPov({ ...streetPanorama.getPov(), heading: 0 });
    }

    function zoomStreetView(delta) {
      if (streetPanorama) streetPanorama.setZoom(Math.max(0, Math.min(4, streetPanorama.getZoom() + delta)));
    }

    function handleStreetSearch(query) {
      const container = document.getElementById('sv-suggestions');
      if (!query || query.trim().length === 0) {
        container.style.display = 'none';
        return;
      }
      const filtered = CU_STREETS.filter(s => s.name.toLowerCase().includes(query.toLowerCase()));
      if (filtered.length > 0) {
        container.innerHTML = filtered.map(s => `
          <div class="sv-suggestion-item" data-street="${CU_STREETS.indexOf(s)}">
            <i data-lucide="map-pin" style="width: 14px; height: 14px; color: #1a73e8;"></i>
            <div>
              <div style="font-weight: 600;">${s.name}</div>
              <div style="font-size: 11px; color: #70757a;">${s.subtitle}</div>
            </div>
          </div>
        `).join('');
        container.style.display = 'block';
        container.querySelectorAll('[data-street]').forEach(item => item.addEventListener('click', () => { const s = CU_STREETS[Number(item.dataset.street)]; selectSuggestion(s.lat, s.lng, s.heading, s.name); }));
        lucide.createIcons({ root: container });
      } else {
        container.style.display = 'none';
      }
    }

    function selectSuggestion(lat, lng, heading, name) {
      document.getElementById('sv-search-input').value = name;
      document.getElementById('sv-suggestions').style.display = 'none';
      openStreetView(lat, lng, heading, name);
    }

    function executeSearch() {
      const query = document.getElementById('sv-search-input').value.trim();
      if (!query) return;
      const found = CU_STREETS.find(s => s.name.toLowerCase().includes(query.toLowerCase()));
      if (found) {
        selectSuggestion(found.lat, found.lng, found.heading, found.name);
      } else {
        alert("Buscando en campus: mostrando punto central en Pedro de Alba.");
        selectSuggestion(CU_STREETS[0].lat, CU_STREETS[0].lng, CU_STREETS[0].heading, CU_STREETS[0].name);
      }
    }

    function initMap() {
      const fimeCenter = { lat: 25.72522, lng: -100.31346 };
      map = new google.maps.Map(document.getElementById("map"), {
        center: fimeCenter, zoom: 17, mapTypeId: 'satellite', disableDefaultUI: true
      });

      map.addListener("click", (e) => {
        closeMenu();
        if (e.latLng) {
          openStreetView(e.latLng.lat(), e.latLng.lng(), 270);
        }
      });
      
      // Asegurarse de dibujar los marcadores que la BD ya había cargado en memoria antes de que Google Maps estuviera listo
      syncMapMarkers(savedReports);
      
      // Comprobar verificaciones al iniciar el mapa
      checkVerifications();
    }

    // MOTOR DE RAYCASTING MATEMÁTICO PARA STREET VIEW
    function getEstimatedLatLng(panorama, x, y) {
      const bounds = document.getElementById('sv-native').getBoundingClientRect();
      const W = bounds.width;
      const H = bounds.height;
      x -= bounds.left; y -= bounds.top;
      const pov = panorama.getPov();
      const pos = panorama.getPosition();
      
      if (!pos || !google.maps.geometry) return pos;

      const dx = x - W / 2;
      const dy = y - H / 2;
      
      // Aproximación del Campo de Visión (FOV)
      const tapHeading = pov.heading + (dx / W) * 90;
      let tapPitch = pov.pitch - (dy / H) * 90;
      
      // Prevenir infinito si tocan el cielo
      if (tapPitch >= -3) tapPitch = -3; 

      const cameraHeight = 2.5; // Metros de altura del carro de Google
      const distance = cameraHeight / Math.tan(Math.abs(tapPitch) * Math.PI / 180);
      
      // Limitar distancia a 60 metros máximo
      const finalDistance = Math.min(distance, 60);

      return google.maps.geometry.spherical.computeOffset(pos, finalDistance, tapHeading);
    }

    // Un toque abre el menú; arrastre, multitáctil y controles mantienen su función.
    let menuGesture = null;
    const menuPointers = new Set();
    const menuControls = '.modal-overlay,.bottom-nav,.back-btn,.sao-menu-overlay,.sv-top-container,.sv-controls-panel,.sv-minimap-wrapper,button,a,input,select,textarea';
    window.addEventListener('pointerdown', event => {
      menuPointers.add(event.pointerId);
      if (menuGesture && menuPointers.size > 1) menuGesture.multi = true;
      if (event.button !== 0 || !event.target.closest('#sv-native') || event.target.closest(menuControls)) return;
      menuGesture = { id: event.pointerId, x: event.clientX, y: event.clientY, time: Date.now(), moved: false, multi: menuPointers.size > 1 };
    }, true);
    window.addEventListener('pointermove', event => {
      if (menuGesture && menuGesture.id === event.pointerId && Math.hypot(event.clientX - menuGesture.x, event.clientY - menuGesture.y) >= 10) menuGesture.moved = true;
    }, true);
    window.addEventListener('pointercancel', event => {
      menuPointers.delete(event.pointerId); menuGesture = null;
    }, true);
    window.addEventListener('pointerup', event => {
      menuPointers.delete(event.pointerId);
      const gesture = menuGesture;
      if (!gesture || gesture.id !== event.pointerId) return;
      menuGesture = null;
      if (gesture.moved || gesture.multi || Date.now() - gesture.time >= 450 || event.target.closest(menuControls)) return;
      if (!event.target.closest('#sv-native') || !streetPanorama || !streetPanorama.getVisible() || activeVerifyReportId) return;
      currentReportLocation = getEstimatedLatLng(streetPanorama, event.clientX, event.clientY);
      openMenu(event.clientX, event.clientY);
    }, true);

    const menuEl = document.getElementById('sao-menu');
    let menuCloseTimer;
    let menuOpenTimer;
    function openMenu(x, y) {
      clearTimeout(menuCloseTimer); clearTimeout(menuOpenTimer);
      menuEl.style.display = 'block';
      menuEl.style.left = x + 'px';
      menuEl.style.top = y + 'px';
      const ripple = document.getElementById('sao-ripple');
      ripple.classList.remove('animate');
      void ripple.offsetWidth; 
      ripple.classList.add('animate');
      menuOpenTimer = setTimeout(() => {
        document.getElementById('sao-close').classList.add('open');
        document.querySelectorAll('.sao-item').forEach(el => el.classList.add('open'));
      }, 50);
    }

    function closeMenu() {
      clearTimeout(menuOpenTimer); clearTimeout(menuCloseTimer);
      document.getElementById('sao-close').classList.remove('open');
      document.querySelectorAll('.sao-item').forEach(el => el.classList.remove('open'));
      menuCloseTimer = setTimeout(() => { menuEl.style.display = 'none'; }, 300);
    }
    document.getElementById('sao-close').addEventListener('click', closeMenu);

    function closeModals() {
      document.querySelectorAll('.modal-overlay').forEach(el => el.style.display = 'none');
    }

    function openAddDetailsModal(tipo) {
      closeMenu();
      currentReportType = tipo;
      const config = reportIcons[tipo];
      document.getElementById('add-modal-title').innerText = "Reportar " + tipo;
      document.getElementById('add-modal-desc').value = "";
      document.getElementById('add-modal-icon').setAttribute('data-lucide', config.icon);
      document.getElementById('add-modal-icon').setAttribute('color', config.color);
      lucide.createIcons();
      document.getElementById('modal-add-details').style.display = 'flex';
    }

    async function submitReport() {
      const desc = document.getElementById('add-modal-desc').value.trim() || "Sin detalles adicionales.";
      
      if (window.reportSubmitting) return;
      window.reportSubmitting = true;
      try {
      await db.addReport({
        type: currentReportType,
        desc: desc,
        location: currentReportLocation,
        cameraPosition: currentSVLocation || currentReportLocation,
        cameraPov: { heading: currentSVHeading || 270, pitch: 0 },
        votesYes: 1, votesNo: 0,
        time: new Date().toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})
      });
      
      closeModals();
      document.getElementById('add-modal-desc').value = '';
      forceExitStreetView();
      alert(`¡Reporte publicado!`);
      } catch (error) {
        db.showError(error);
        alert("No se publicó el reporte. Tus datos siguen en el formulario; intenta nuevamente.");
      } finally { window.reportSubmitting = false; }
    }

    function openViewReportModal(reportId) {
      const report = savedReports.find(r => r.id === reportId);
      if(!report) return;
      activeViewingReportId = reportId;

      document.getElementById('view-modal-title').innerText = report.type;
      document.getElementById('view-modal-desc').innerText = `"${escapeHtml(report.desc)}" \n\n (Votos: ${escapeHtml(report.votesYes)} Sí / ${escapeHtml(report.votesNo)} No)`;
      document.getElementById('view-modal-time').innerText = "Reportado a las " + report.time;
      
      const config = reportIcons[report.type] || reportIcons['Bache'];
      document.getElementById('view-modal-icon').setAttribute('data-lucide', config.icon);
      document.getElementById('view-modal-icon').setAttribute('color', config.color);
      lucide.createIcons();

      document.getElementById('modal-view-report').style.display = 'flex';
    }

    function teleportToReport() {
      const report = savedReports.find(r => r.id === activeViewingReportId);
      if(report) {
        closeModals();
        switchTab('map'); 
        activeVerifyReportId = report.id;
        openStreetView(report.location.lat, report.location.lng, 270, report.type + " reportado");
      }
    }

    function attemptExitStreetView() {
      if (activeVerifyReportId) {
        document.getElementById('modal-vote').style.display = 'flex';
      } else {
        forceExitStreetView();
      }
    }

    async function submitVote(type) {
      if (!activeVerifyReportId) return;
      if (type !== 'skip') {
          await db.updateReportVotes(activeVerifyReportId, type);
      }
      document.getElementById('modal-vote').style.display = 'none';
      
      forceExitStreetView();
      
      if (pendingTabSwitch) {
          const target = pendingTabSwitch;
          pendingTabSwitch = null;
          switchTab(target);
      }
    }
    


    let isLoggedIn = false;
    let currentUser = db.getCurrentUser();
    if (currentUser) {
       isLoggedIn = true;
    }

    function updateProfileView() {
      if (isLoggedIn) {
        document.getElementById('login-view').style.display = 'none';
        document.getElementById('logged-view').style.display = 'block';
        renderList('my-reports-list', true);
      } else {
        document.getElementById('login-view').style.display = 'flex';
        document.getElementById('logged-view').style.display = 'none';
      }
    }
    
    async function doLogin() {
      const user = 'visitante';

      if (!user) { alert("Ingresa tu correo o matrícula"); return; }
      
      try {
        currentUser = await db.login(user);
        isLoggedIn = true;
        updateProfileView();
        checkVerifications(); // Checkear verificaciones si ya hay sesión activa
      } catch (error) {
        alert(error);
      }
    }
    
    function doLogout() {
      db.logout();
      isLoggedIn = false;
      currentUser = null;


      lucide.createIcons();
      updateProfileView();
      
      checkVerifications(); // Checkear verificaciones si ya hay sesión activa
    }

    let pendingTabSwitch = null;

    function switchTab(tab) {
      // Si el usuario está viendo un reporte (Street View) e intenta cambiar de pestaña
      if (activeVerifyReportId) {
        pendingTabSwitch = tab;
        document.getElementById('modal-vote').style.display = 'flex';
        return; // Detiene el cambio de pestaña hasta que vote
      }

      if (viewingMarker3D) { viewingMarker3D.setMap(null); viewingMarker3D = null; }
      activeVerifyReportId = null;
      document.getElementById('sao-menu').style.display = 'none';

      document.querySelectorAll('.nav-item').forEach(btn => btn.classList.remove('active'));
      const activeBtn = document.querySelectorAll('.nav-item')[['map', 'feed', 'profile'].indexOf(tab)];
      if(activeBtn) activeBtn.classList.add('active');

      if (tab === 'map') {
        document.getElementById('screen-map').style.display = 'block';
        document.getElementById('screen-feed').style.display = 'none';
        document.getElementById('screen-profile').style.display = 'none';
      } else if (tab === 'feed') {
        document.getElementById('screen-map').style.display = 'none';
        document.getElementById('screen-feed').style.display = 'block';
        document.getElementById('screen-profile').style.display = 'none';
        renderList('feed-list-container', false);
      } else if (tab === 'profile') {
        document.getElementById('screen-map').style.display = 'none';
        document.getElementById('screen-feed').style.display = 'none';
        document.getElementById('screen-profile').style.display = 'block';
        updateProfileView();
      }
    }

    function forceExitStreetView() {
      activeVerifyReportId = null;
      if (viewingMarker3D) {
        viewingMarker3D.setMap(null);
        viewingMarker3D = null;
      }
      const svWrapper = document.getElementById('streetview-wrapper');
      if (svWrapper) svWrapper.style.display = 'none';

      if (streetPanorama) streetPanorama.setVisible(false);

      const overlay = document.getElementById('main-map-overlay');
      if (overlay) overlay.style.display = 'flex';

      const backBtn = document.getElementById('back-btn');
      if (backBtn) backBtn.style.display = 'none';



      closeMenu();
    }

    function renderList(containerId, onlyMine) {
      const container = document.getElementById(containerId);
      container.innerHTML = '';
      
      let filtered = savedReports;
      if (onlyMine) {
        // En la vida real, se filtra por userId
        const user = db.getCurrentUser();
        if (user) {
           filtered = savedReports.filter(r => r.ownerUid === user.uid);
        } else {
           filtered = [];
        }
      }

      if (filtered.length === 0) {
        container.innerHTML = '<p style="text-align:center; color:#7f8c8d; margin-top:50px;">Aún no hay reportes.</p>';
        return;
      }

      const sorted = [...filtered].reverse();
      sorted.forEach(report => {
        const config = reportIcons[report.type] || reportIcons['Bache'];
        const card = document.createElement('div');
        card.className = 'report-card type-' + (Object.hasOwn(reportIcons, report.type) ? report.type : 'Bache');
        card.innerHTML = `
          <div id="thumb-${escapeHtml(report.id)}" class="card-sv-thumbnail"></div>
          <div class="card-content-overlay">
            <div class="card-header">
              <span class="card-type" style="color: ${config.color}"><i data-lucide="${config.icon}" style="width:18px;"></i> ${escapeHtml(report.type)}</span>
              <span class="card-time">${escapeHtml(report.time)}</span>
            </div>
            <div class="card-body-wrapper">
              <div class="card-desc">"${escapeHtml(report.desc)}"</div>
              <div class="card-votes">
                <span><i data-lucide="thumbs-up" style="width:14px;"></i> ${escapeHtml(report.votesYes)} Sigue ahí</span>
                <span><i data-lucide="thumbs-down" style="width:14px;"></i> ${escapeHtml(report.votesNo)} Ya no</span>
              </div>
              <button class="btn-view-map">
                <i data-lucide="map-pin" style="width:16px;"></i> Ver Detalles
              </button>
            </div>
          </div>
        `;
        card.querySelector('.btn-view-map').addEventListener('click', () => openViewReportModal(report.id));
      container.appendChild(card);
        
        // Inicializar miniatura de Street View en la tarjeta
        setTimeout(() => {
          const thumbEl = document.getElementById(`thumb-${escapeHtml(report.id)}`);
          if (thumbEl) {
             try {
                 // Fallback para reportes muy viejos que no tenían cámara guardada
                 const pos = report.cameraPosition || report.location;
                 
                 const pano = new google.maps.StreetViewPanorama(thumbEl, {
                    position: pos,
                    pov: report.cameraPov || { heading: 0, pitch: 0 },
                    zoom: (report.cameraPov && report.cameraPov.zoom) ? report.cameraPov.zoom : 0,
                    disableDefaultUI: true,
                    clickToGo: false,
                    linksControl: false,
                    panControl: false,
                    zoomControl: false,
                    gestureHandling: 'none'
                 });
                 
                 // Poner el puntito amarillo exactamente en el lugar
                 new google.maps.Marker({
                   position: report.location,
                   map: pano,
                   icon: {
                     path: google.maps.SymbolPath.CIRCLE,
                     scale: 8,
                     fillColor: "#ff9900",
                     fillOpacity: 1,
                     strokeWeight: 2,
                     strokeColor: "#ffffff"
                   }
                 });
             } catch(e) {
                 console.error("Error al cargar la miniatura de SV", e);
             }
          }
        }, 100);
      });
      lucide.createIcons();
    }

    // ==============================================
    // LÓGICA DE VERIFICACIÓN AL ABRIR LA APP
    // ==========================================
    let pendingVerifications = [];
    
    async function checkVerifications() {
      if (!isLoggedIn || !currentUser) return;
      pendingVerifications = await db.getReportsPendingVerification(currentUser.matricula);
      if (pendingVerifications.length > 0) {
        showNextVerification();
      }
    }
    
    function showNextVerification() {
      if (pendingVerifications.length === 0) {
        document.getElementById('verify-modal').style.display = 'none';
        return;
      }
      const report = pendingVerifications[0];
      document.getElementById('verify-modal-text').innerHTML = `Tu reporte <strong>"${escapeHtml(report.desc)}"</strong> (${escapeHtml(String(report.type).toUpperCase())}) tiene más de 8 horas. ¿Sigue el problema en el lugar?`;
      document.getElementById('verify-modal').style.display = 'flex';
    }
    
    async function handleVerifyAction(action) {
      const report = pendingVerifications[0];
      if (action === 'renew') {
        await db.renewReport(report.id);
        alert("✅ Reporte renovado por otras 8 horas.");
      } else if (action === 'delete') {
        alert('La resolución de un reporte requiere revisión de una cuenta administradora autorizada.');
        return;
      }
      pendingVerifications.shift(); // Quitar el actual
      showNextVerification(); // Mostrar el siguiente si hay más
    }


  
const uiActions = {
"ui-0": function(event) { attemptExitStreetView(); },
"ui-1": function(event) { handleStreetSearch(this.value); },
"ui-2": function(event) { if(event.key==='Enter') executeSearch(); },
"ui-3": function(event) { executeSearch(); },
"ui-4": function(event) { toggleMinimap(); },
"ui-5": function(event) { resetCompass(); },
"ui-6": function(event) { zoomStreetView(1); },
"ui-7": function(event) { zoomStreetView(-1); },
"ui-8": function(event) { openAddDetailsModal('Bache'); },
"ui-9": function(event) { openAddDetailsModal('Tráfico'); },
"ui-10": function(event) { openAddDetailsModal('Bloqueo'); },
"ui-11": function(event) { doLogin(); },
"ui-12": function(event) { doLogout(); },
"ui-13": function(event) { switchTab('map'); },
"ui-14": function(event) { switchTab('feed'); },
"ui-15": function(event) { switchTab('profile'); },
"ui-16": function(event) { closeModals(); },
"ui-17": function(event) { submitReport(); },
"ui-18": function(event) { closeModals(); },
"ui-19": function(event) { teleportToReport(); },
"ui-20": function(event) { submitVote('yes'); },
"ui-21": function(event) { submitVote('no'); },
"ui-22": function(event) { submitVote('skip'); },
"ui-23": function(event) { handleVerifyAction('renew'); },
"ui-24": function(event) { handleVerifyAction('delete'); }
};
document.addEventListener('click', event => { const target = event.target.closest('[data-click]'); if (target) uiActions[target.dataset.click]?.call(target, event); });
document.addEventListener('input', event => { const target = event.target.closest('[data-input]'); if (target) uiActions[target.dataset.input]?.call(target, event); });
document.addEventListener('keydown', event => { const target = event.target.closest('[data-keydown]'); if (target) uiActions[target.dataset.keydown]?.call(target, event); });
