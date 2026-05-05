'use strict';
/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('GuBoundaries', {
      id: {
        allowNull: false,
        autoIncrement: true,
        primaryKey: true,
        type: Sequelize.INTEGER
      },
      gu_name: {
        type: Sequelize.STRING(50),
        allowNull: false
      },
      boundary_polygon: {
        type: Sequelize.GEOMETRY('POLYGON', 4326),
        allowNull: false,
        comment: "구역 경계 데이터 (SPATIAL INDEX 적용)"
      },
      created_at: {
        allowNull: false,
        type: Sequelize.DATE,
        defaultValue: Sequelize.literal('CURRENT_TIMESTAMP')
      },
      updated_at: {
        allowNull: false,
        type: Sequelize.DATE,
        defaultValue: Sequelize.literal('CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP')
      }
    });
    await queryInterface.addIndex('GuBoundaries', ['boundary_polygon'], {
      type: 'SPATIAL',
      name: 'gu_boundaries_polygon_spatial'
    });
  },
  async down(queryInterface, Sequelize) {
    await queryInterface.dropTable('GuBoundaries');
  }
};