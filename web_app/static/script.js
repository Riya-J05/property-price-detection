/**
 * Property Valuation AI - Client-Side Logic
 * Handles interactive presets, form validation, Indian Rupee formatting,
 * and asynchronous communication with Flask.
 */

document.addEventListener('DOMContentLoaded', () => {
    // 1. SELECT DOM ELEMENTS
    const form = document.getElementById('price-form');
    const submitBtn = document.getElementById('submit-btn');
    const btnText = submitBtn.querySelector('.btn-text');
    const btnIcon = submitBtn.querySelector('.btn-icon');
    const btnSpinner = submitBtn.querySelector('.btn-spinner');
    const errorBanner = document.getElementById('error-banner');
    const errorMessage = document.getElementById('error-message');
    const resultCard = document.getElementById('result-card');

    // Result value placeholders
    const priceLakhsFigure = document.getElementById('price-lakhs-figure');
    const formattedInr = document.getElementById('formatted-inr');
    const ratePerSqft = document.getElementById('rate-per-sqft');
    const resLocation = document.getElementById('res-location');
    const resConfig = document.getElementById('res-config');
    const resultTimestamp = document.getElementById('result-timestamp');

    // 2. PRESET TEST DATASETS
    // Enables single-click testing of realistic properties
    const presets = {
        'preset-notebook': {
            // Exactly matches the sample in 05_model_inference.ipynb
            property_type: 'apartment',
            location: 'rohini',
            area_sqft: 1200,
            bedrooms: 2,
            bathrooms: 2,
            age_years: 5,
            floor: 3,
            total_floors: 4,
            parking: 'yes',
            furnishing: 'semi-furnished',
            distance_to_metro_km: 1.2,
            nearby_schools: 3,
            monthly_maintenance_inr: 2500,
            has_gym: 'no',
            has_security: 'yes'
        },
        'preset-gurugram': {
            property_type: 'builder floor',
            location: 'gurugram',
            area_sqft: 1850,
            bedrooms: 3,
            bathrooms: 3,
            age_years: 2,
            floor: 2,
            total_floors: 4,
            parking: 'yes',
            furnishing: 'fully-furnished',
            distance_to_metro_km: 0.8,
            nearby_schools: 4,
            monthly_maintenance_inr: 4500,
            has_gym: 'yes',
            has_security: 'yes'
        },
        'preset-villa': {
            property_type: 'independent house',
            location: 'dwarka',
            area_sqft: 2800,
            bedrooms: 4,
            bathrooms: 4,
            age_years: 8,
            floor: 0,
            total_floors: 2,
            parking: 'yes',
            furnishing: 'semi-furnished',
            distance_to_metro_km: 1.5,
            nearby_schools: 5,
            monthly_maintenance_inr: 1500,
            has_gym: 'no',
            has_security: 'yes'
        }
    };

    // 3. ATTACH PRESET BUTTON HANDLERS
    document.querySelectorAll('.preset-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.preset-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');

            const presetData = presets[btn.id];
            if (presetData) {
                populateForm(presetData);
                hideError();
            }
        });
    });

    function populateForm(data) {
        for (const [key, value] of Object.entries(data)) {
            const field = document.getElementById(key);
            if (field) {
                field.value = value;
            }
        }
    }

    // 4. HELPER: FORMAT CURRENCY (Lakhs & Crores)
    function formatIndianCurrency(lakhs) {
        const roundedLakhs = Number(lakhs).toFixed(2);
        if (lakhs >= 100) {
            const crores = (lakhs / 100).toFixed(2);
            return `Approx. <strong class="inr-highlight">₹${crores} Crore</strong> (₹${roundedLakhs} Lakhs)`;
        } else {
            return `Approx. <strong class="inr-highlight">₹${roundedLakhs} Lakhs</strong>`;
        }
    }

    // 5. HELPER: SHOW & HIDE ERRORS
    function showError(msg) {
        errorMessage.textContent = msg;
        errorBanner.classList.remove('hidden');
        errorBanner.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }

    function hideError() {
        errorBanner.classList.add('hidden');
        errorMessage.textContent = '';
    }

    // 6. HELPER: LOADING SPINNER STATE
    function setLoading(isLoading) {
        if (isLoading) {
            submitBtn.disabled = true;
            btnText.textContent = 'Estimating Valuation...';
            btnIcon.classList.add('hidden');
            btnSpinner.classList.remove('hidden');
        } else {
            submitBtn.disabled = false;
            btnText.textContent = 'Estimate Property Price';
            btnIcon.classList.remove('hidden');
            btnSpinner.classList.add('hidden');
        }
    }

    // 7. FORM SUBMISSION EVENT LISTENER
    form.addEventListener('submit', async (e) => {
        e.preventDefault(); // Prevents full-page browser refresh
        hideError();

        // Collect all 15 form values into a clean JavaScript object
        const formData = {
            property_type: document.getElementById('property_type').value,
            location: document.getElementById('location').value,
            area_sqft: parseFloat(document.getElementById('area_sqft').value),
            bedrooms: parseInt(document.getElementById('bedrooms').value, 10),
            bathrooms: parseInt(document.getElementById('bathrooms').value, 10),
            age_years: parseFloat(document.getElementById('age_years').value),
            floor: parseInt(document.getElementById('floor').value, 10),
            total_floors: parseInt(document.getElementById('total_floors').value, 10),
            parking: document.getElementById('parking').value,
            furnishing: document.getElementById('furnishing').value,
            distance_to_metro_km: parseFloat(document.getElementById('distance_to_metro_km').value),
            nearby_schools: parseInt(document.getElementById('nearby_schools').value, 10),
            monthly_maintenance_inr: parseFloat(document.getElementById('monthly_maintenance_inr').value),
            has_gym: document.getElementById('has_gym').value,
            has_security: document.getElementById('has_security').value
        };

        // Client-Side Validation: Catch logical errors early
        if (isNaN(formData.area_sqft) || formData.area_sqft <= 0) {
            showError('Please enter a valid positive area in square feet.');
            return;
        }

        if (formData.floor > formData.total_floors) {
            showError(`Property floor (${formData.floor}) cannot be higher than the building total floors (${formData.total_floors}).`);
            return;
        }

        setLoading(true);

        try {
            // Send JSON POST request to Flask endpoint
            const response = await fetch('/predict', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(formData)
            });

            if (!response.ok) {
                const errorData = await response.json().catch(() => ({}));
                throw new Error(errorData.error || `Server responded with status ${response.status}`);
            }

            const data = await response.json();

            // Update UI with real prediction returned from Flask
            updateResultUI(data.price_lakhs, formData);

        } catch (err) {
            // Friendly error handling: if Flask is not yet running (Stage 1 / local file preview),
            // inform the user gracefully rather than crashing.
            if (err.message.includes('Failed to fetch') || window.location.protocol === 'file:') {
                console.info('Flask backend is not running yet (Stage 1/2 frontend preview mode). Simulating baseline for visual verification.');
                // Show sample baseline calculation for preview
                updateResultUI(100.70, formData);
                resultTimestamp.textContent = 'Preview Mode (Start Flask in Stage 3 for live API inference)';
            } else {
                showError(err.message || 'Unable to calculate price. Please verify inputs.');
            }
        } finally {
            setLoading(false);
        }
    });

    function updateResultUI(priceLakhs, formData) {
        priceLakhsFigure.textContent = Number(priceLakhs).toFixed(2);
        formattedInr.innerHTML = formatIndianCurrency(priceLakhs);

        // Calculate rate per sqft
        if (formData.area_sqft > 0) {
            const priceInRupees = priceLakhs * 100000;
            const rate = Math.round(priceInRupees / formData.area_sqft);
            ratePerSqft.textContent = `₹${rate.toLocaleString('en-IN')}`;
        }

        // Update tags
        resLocation.textContent = formData.location.charAt(0).toUpperCase() + formData.location.slice(1);
        resConfig.textContent = `${formData.bedrooms} BHK ${formData.property_type.charAt(0).toUpperCase() + formData.property_type.slice(1)}`;
        resultTimestamp.textContent = `Calculated at ${new Date().toLocaleTimeString()}`;

        // Smooth scroll to result card
        resultCard.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
});
