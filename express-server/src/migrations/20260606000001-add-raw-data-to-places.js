'use strict';
/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    // TripAdvisor 응답 일부는 좌표가 없으므로 nullable로 변경
    await queryInterface.changeColumn('Places', 'coordinates', {
      type: Sequelize.GEOMETRY('POINT', 4326),
      allowNull: true,
    });

    await queryInterface.addColumn('Places', 'raw_data', {
      type: Sequelize.JSON,
      allowNull: true,
    });
  },

  async down(queryInterface, Sequelize) {
    await queryInterface.removeColumn('Places', 'raw_data');
    await queryInterface.changeColumn('Places', 'coordinates', {
      type: Sequelize.GEOMETRY('POINT', 4326),
      allowNull: false,
    });
  },
};